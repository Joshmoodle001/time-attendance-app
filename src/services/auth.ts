export type AuthRole = "super_admin" | "admin" | "divisional" | "regional" | "rep";

export type AuthUser = {
  username: string;
  secret: string;
  role: AuthRole;
  name: string;
  surname: string;
  coversheetCode?: string;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  active: boolean;
};

export type AuthSession = {
  username: string;
  role: AuthRole;
  name: string;
  surname: string;
  coversheetCode?: string;
  loggedInAt: string;
};

const SESSION_STORAGE_KEY = "pfm-auth-session-v3";
const LOG_STORAGE_KEY = "pfm-auth-logs-v1";
const LEGACY_AUTH_STATE_STORAGE_KEY = "pfm-auth-state-v2";
const LEGACY_MIGRATION_FLAG_KEY = "pfm-auth-legacy-migrated-v1";

export const DEFAULT_SUPER_ADMIN_USERNAME = "josh@pfm.co.za";
export const DEFAULT_SUPER_ADMIN_SECRET = "1234";

const ROLE_LABELS: Record<AuthRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  divisional: "Divisional",
  regional: "Regional",
  rep: "Rep",
};

const ROLE_HIERARCHY: Record<AuthRole, number> = {
  super_admin: 5,
  admin: 4,
  divisional: 3,
  regional: 2,
  rep: 1,
};

type AuthApiResponse<T> = {
  success: boolean;
  error?: string;
  user?: AuthUser;
  users?: AuthUser[];
  session?: AuthSession | null;
  message?: string;
};

type LegacyAuthState = {
  users?: Record<string, AuthUser>;
};

function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isRootSuperAdminUsername(username: string | undefined | null) {
  return normalizeUsername(String(username || "")) === normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
}

function normalizeSession(session: AuthSession | null) {
  if (!session) return null;
  if (isRootSuperAdminUsername(session.username)) {
    return { ...session, role: "super_admin" as const };
  }
  return session;
}

function readLocalLogs() {
  if (!canUseStorage()) return [] as Array<{ timestamp: string; action: string; user?: string; details: string }>;
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalLogs(logs: Array<{ timestamp: string; action: string; user?: string; details: string }>) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.slice(0, 500)));
  } catch {
    // ignore
  }
}

function addLog(action: string, user?: string, details = "") {
  const logs = readLocalLogs();
  logs.unshift({
    timestamp: new Date().toISOString(),
    action,
    user,
    details,
  });
  saveLocalLogs(logs);
}

function saveSession(session: AuthSession | null) {
  if (!canUseStorage()) return;
  try {
    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalizeSession(session)));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function readLegacyUsers(): AuthUser[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_AUTH_STATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyAuthState;
    const users = parsed?.users && typeof parsed.users === "object" ? Object.values(parsed.users) : [];
    return Array.isArray(users) ? users.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function fetchAuthApi<T>(body?: Record<string, unknown>, query?: URLSearchParams) {
  const url = `/api/auth-users${query && Array.from(query.keys()).length > 0 ? `?${query.toString()}` : ""}`;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; success?: boolean };
  if (!response.ok) {
    throw new Error(payload?.error || `Auth request failed with status ${response.status}`);
  }
  return payload;
}

async function migrateLegacyUsersIfNeeded() {
  if (!canUseStorage()) return;
  try {
    if (window.localStorage.getItem(LEGACY_MIGRATION_FLAG_KEY) === "done") return;
  } catch {
    return;
  }

  const legacyUsers = readLegacyUsers();
  if (legacyUsers.length === 0) {
    try {
      window.localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, "done");
    } catch {
      // ignore
    }
    return;
  }

  try {
    await fetchAuthApi<AuthApiResponse<never>>({
      action: "syncLegacy",
      users: legacyUsers,
    });
    window.localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, "done");
  } catch {
    // leave the flag unset so a later successful bootstrap can retry
  }
}

export function canManageRole(requestingRole: AuthRole, targetRole: AuthRole): boolean {
  return ROLE_HIERARCHY[requestingRole] > ROLE_HIERARCHY[targetRole];
}

export function getRoleLabel(role: AuthRole): string {
  return ROLE_LABELS[role] || role;
}

export function getAllRoles(): AuthRole[] {
  return ["super_admin", "admin", "divisional", "regional", "rep"];
}

export function getDefaultSuperAdminCredentials() {
  return {
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    password: DEFAULT_SUPER_ADMIN_SECRET,
  };
}

export async function ensureSuperAdminSeeded() {
  const response = await fetchAuthApi<AuthApiResponse<never>>({ action: "ensureSeed" });
  await migrateLegacyUsersIfNeeded();
  return response;
}

export async function fixSuperAdmin() {
  return ensureSuperAdminSeeded();
}

export function getAuthSession() {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return normalizeSession(JSON.parse(raw) as AuthSession);
  } catch {
    return null;
  }
}

export function refreshSession() {
  return getAuthSession();
}

export async function refreshSessionRemote() {
  const session = getAuthSession();
  if (!session) return null;

  try {
    const payload = await fetchAuthApi<AuthApiResponse<never>>({
      action: "refreshSession",
      username: session.username,
    });
    const nextSession = normalizeSession(payload.session || null);
    saveSession(nextSession);
    return nextSession;
  } catch {
    return normalizeSession(session);
  }
}

export async function login(username: string, password: string) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "login",
    username,
    password,
  });

  if (!payload.success || !payload.session) {
    addLog("LOGIN_FAILED", username, payload.error || "Login failed");
    return { success: false as const, error: payload.error || "Login failed." };
  }

  const session = normalizeSession(payload.session);
  saveSession(session);
  addLog("LOGIN_SUCCESS", username, `Logged in as ${session?.role || "unknown"}`);
  return { success: true as const, session: session as AuthSession };
}

export function logout() {
  const session = getAuthSession();
  if (session) {
    addLog("LOGOUT", session.username);
  }
  saveSession(null);
}

export async function getUsers(): Promise<AuthUser[]> {
  const payload = await fetchAuthApi<AuthApiResponse<never>>();
  return (payload.users || []).map((user) =>
    isRootSuperAdminUsername(user.username) ? { ...user, role: "super_admin" } : user
  );
}

export async function getUser(username: string): Promise<AuthUser | null> {
  const params = new URLSearchParams({ username });
  const payload = await fetchAuthApi<AuthApiResponse<never>>(undefined, params);
  return payload.user || null;
}

export async function createUser(
  requestingSession: AuthSession,
  userData: { username: string; password: string; role: AuthRole; name: string; surname: string }
) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "createUser",
    requester: requestingSession,
    userData,
  });

  if (payload.success) {
    addLog("USER_CREATED", requestingSession.username, `Created user: ${userData.username} (${userData.role})`);
    return { success: true as const, user: payload.user };
  }

  return { success: false as const, error: payload.error || "Could not create user." };
}

export async function updateUser(
  requestingSession: AuthSession,
  targetUsername: string,
  updates: { name?: string; surname?: string; role?: AuthRole; active?: boolean }
) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "updateUser",
    requester: requestingSession,
    targetUsername,
    updates,
  });

  if (payload.success) {
    const currentSession = getAuthSession();
    if (currentSession && normalizeUsername(currentSession.username) === normalizeUsername(targetUsername) && payload.user) {
      saveSession({
        username: payload.user.username,
        role: payload.user.role,
        name: payload.user.name,
        surname: payload.user.surname,
        coversheetCode: payload.user.coversheetCode || "",
        loggedInAt: currentSession.loggedInAt,
      });
    }
    addLog("USER_UPDATED", requestingSession.username, `Updated user: ${targetUsername}`);
    return { success: true as const, user: payload.user };
  }

  return { success: false as const, error: payload.error || "Could not update user." };
}

export async function resetUserPassword(requestingSession: AuthSession, targetUsername: string, newPassword: string) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "resetPassword",
    requester: requestingSession,
    targetUsername,
    newPassword,
  });

  if (payload.success) {
    addLog("PASSWORD_RESET", requestingSession.username, `Reset password for: ${targetUsername}`);
    return { success: true as const, message: payload.message || "Password has been reset." };
  }

  return { success: false as const, error: payload.error || "Could not reset password." };
}

export async function deleteUser(requestingSession: AuthSession, targetUsername: string) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "deleteUser",
    requester: requestingSession,
    targetUsername,
  });

  if (payload.success) {
    addLog("USER_DELETED", requestingSession.username, `Deleted user: ${targetUsername}`);
    return { success: true as const, message: payload.message || "User deleted successfully." };
  }

  return { success: false as const, error: payload.error || "Could not delete user." };
}

export async function updateOwnPassword(session: AuthSession, currentPassword: string, newPassword: string) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "updateOwnPassword",
    requester: session,
    currentPassword,
    newPassword,
  });

  if (payload.success) {
    addLog("PASSWORD_CHANGED", session.username);
    return { success: true as const, message: payload.message || "Password changed successfully." };
  }

  return { success: false as const, error: payload.error || "Could not change password." };
}

export async function registerRep(userData: { username: string; password: string; name: string; surname: string; coversheetCode?: string }) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "registerRep",
    userData,
  });

  if (payload.success) {
    addLog("USER_REGISTERED", userData.username, "Self-registered as rep");
    return { success: true as const, user: payload.user };
  }

  return { success: false as const, error: payload.error || "Could not create the rep account." };
}

export async function updateUserProfile(
  username: string,
  name: string,
  surname: string,
  options?: { coversheetCode?: string | null }
) {
  const payload = await fetchAuthApi<AuthApiResponse<never>>({
    action: "updateProfile",
    username,
    name,
    surname,
    coversheetCode: String(options?.coversheetCode || "").trim(),
  });

  if (!payload.success || !payload.user) {
    return { success: false as const, error: payload.error || "User not found." };
  }

  const currentSession = getAuthSession();
  const nextSession =
    currentSession && normalizeUsername(currentSession.username) === normalizeUsername(payload.user.username)
      ? {
          username: payload.user.username,
          role: payload.user.role,
          name: payload.user.name,
          surname: payload.user.surname,
          coversheetCode: payload.user.coversheetCode || "",
          loggedInAt: currentSession.loggedInAt,
        }
      : currentSession;

  if (nextSession) saveSession(nextSession);

  addLog("PROFILE_UPDATED", username);
  return { success: true as const, session: nextSession || null, message: "Profile updated successfully." };
}

export function getLogs(): Array<{ timestamp: string; action: string; user?: string; details: string }> {
  return readLocalLogs();
}

export function clearLogs() {
  saveLocalLogs([]);
  return { success: true };
}

const APP_STORAGE_KEYS = [
  SESSION_STORAGE_KEY,
  LOG_STORAGE_KEY,
  LEGACY_AUTH_STATE_STORAGE_KEY,
  LEGACY_MIGRATION_FLAG_KEY,
  "employee-profiles-cache-v1",
  "attendance-records-cache-v1",
  "pfm-clock-cache-v1",
  "ipulse-config-v1",
  "ipulse-sync-logs-v1",
  "shift-roster-cache-v1",
  "shift-sync-settings-v1",
  "shift-sync-settings-v2",
  "leave-applications-cache-v1",
  "leave-uploads-cache-v1",
  "employee-update-logs-v1",
  "pfm-trial-reset-v1",
  "calendar-events-v1",
  "calendar-builder-events-v1",
  "coversheet-data-v1",
  "employee-source-mode-v1",
  "employee-status-history-cache-v1",
  "employee-unsupported-remote-columns-v1",
  "device-records-v1",
  "device-import-date-v1",
  "last-attendance-date-v1",
  "biometric-clock-events-cache-v1",
  "pfm-store-assignments-v1",
  "payroll-settings-v1",
];

export async function clearAllAppData() {
  if (typeof window === "undefined" || !window.localStorage) {
    return { success: false, message: "Cannot access localStorage" };
  }

  let cleared = 0;
  for (const key of APP_STORAGE_KEYS) {
    if (window.localStorage.getItem(key) !== null) {
      window.localStorage.removeItem(key);
      cleared++;
    }
  }

  const idbDatabases = [
    "time-attendance-employee-db",
    "clock-events-db",
    "time-attendance-clock-db",
    "time-attendance-coversheet-db",
    "time-attendance-device-cache-v1",
    "time-attendance-employee-update-log-db",
    "time-attendance-emergency-employee-overrides-db",
  ];

  for (const dbName of idbDatabases) {
    try {
      await new Promise<void>((resolve) => {
        const req = window.indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => {
          cleared++;
          resolve();
        };
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  return { success: true, message: `Cleared ${cleared} storage items.` };
}

(window as unknown as { clearAllAppData: typeof clearAllAppData }).clearAllAppData = clearAllAppData;
(window as unknown as { fixSuperAdmin: typeof fixSuperAdmin }).fixSuperAdmin = fixSuperAdmin;
