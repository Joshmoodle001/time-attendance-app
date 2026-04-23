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

type AuthState = {
  users: Record<string, AuthUser>;
  session: AuthSession | null;
  logs: Array<{ timestamp: string; action: string; user?: string; details: string }>;
};

const STORAGE_KEY = "pfm-auth-state-v2";
export const DEFAULT_SUPER_ADMIN_USERNAME = ["josh", "pfm.co.za"].join("@");
export const DEFAULT_SUPER_ADMIN_SECRET = "PFM@dmin2026!";

function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

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

export function canManageRole(requestingRole: AuthRole, targetRole: AuthRole): boolean {
  return ROLE_HIERARCHY[requestingRole] > ROLE_HIERARCHY[targetRole];
}

export function getRoleLabel(role: AuthRole): string {
  return ROLE_LABELS[role] || role;
}

export function getAllRoles(): AuthRole[] {
  return ["super_admin", "admin", "divisional", "regional", "rep"];
}

function createDefaultSuperAdmin(): AuthUser {
  const now = new Date().toISOString();
  return {
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    secret: "1234",
    role: "super_admin",
    name: "Josh",
    surname: "Moodle",
    coversheetCode: "",
    createdAt: now,
    updatedAt: now,
    active: true,
  };
}

function getFallbackState(): AuthState {
  const defaultAdmin = createDefaultSuperAdmin();
  return {
    users: {
      [normalizeUsername(defaultAdmin.username)]: defaultAdmin,
    },
    session: null,
    logs: [],
  };
}

function createExampleUsers(): AuthUser[] {
  const now = new Date().toISOString();
  return [
    {
      username: "rep1@pfm.co.za",
      secret: "Rep123",
      role: "rep" as AuthRole,
      name: "_rep1",
      surname: "User",
      coversheetCode: "",
      createdAt: now,
      updatedAt: now,
      active: true,
    },
    {
      username: "rep2@pfm.co.za",
      secret: "Rep123",
      role: "rep" as AuthRole,
      name: "rep2",
      surname: "User",
      coversheetCode: "",
      createdAt: now,
      updatedAt: now,
      active: true,
    },
    {
      username: "rep3@pfm.co.za",
      secret: "Rep123",
      role: "rep" as AuthRole,
      name: "rep3",
      surname: "User",
      coversheetCode: "",
      createdAt: now,
      updatedAt: now,
      active: true,
    },
  ];
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function saveState(state: AuthState) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save auth state:", e);
  }
}

function readState(): AuthState {
  if (!canUseStorage()) return getFallbackState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const next = getFallbackState();
      // Force password to 1234 for josh@pfm.co.za
      const defaultKey = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
      if (next.users[defaultKey]) {
        next.users[defaultKey].secret = "1234";
      }
      saveState(next);
      return next;
    }

    const parsed = JSON.parse(raw) as Partial<AuthState>;
    const next: AuthState = {
      users: parsed?.users && typeof parsed.users === "object" ? parsed.users as Record<string, AuthUser> : {},
      session: parsed?.session ?? null,
      logs: parsed?.logs ?? [],
    };

    const defaultKey = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
    if (!next.users[defaultKey]) {
      next.users[defaultKey] = createDefaultSuperAdmin();
      next.users[defaultKey].secret = "1234";
      saveState(next);
    } else if (next.users[defaultKey].secret !== "1234") {
      next.users[defaultKey].secret = "1234";
      next.users[defaultKey].updatedAt = new Date().toISOString();
      saveState(next);
    }

    // Ensure all users have the active field
    Object.keys(next.users).forEach(key => {
      if (next.users[key].active === undefined) {
        next.users[key].active = true;
      }
      if (typeof next.users[key].coversheetCode !== "string") {
        next.users[key].coversheetCode = "";
      }
    });

    return next;
  } catch {
    const next = getFallbackState();
    saveState(next);
    return next;
  }
}

function addLog(action: string, user?: string, details: string = "") {
  const state = readState();
  state.logs.unshift({
    timestamp: new Date().toISOString(),
    action,
    user,
    details,
  });
  // Keep only last 500 logs
  if (state.logs.length > 500) {
    state.logs = state.logs.slice(0, 500);
  }
  saveState(state);
}

export function ensureSuperAdminSeeded() {
  const state = readState();
  const key = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
  if (!state.users[key]) {
    state.users[key] = createDefaultSuperAdmin();
    saveState(state);
  }
  // Create example users if first time
  if (Object.keys(state.users).length === 1) {
    const examples = createExampleUsers();
    examples.forEach(user => {
      state.users[normalizeUsername(user.username)] = user;
    });
    saveState(state);
  }
  return state.users[key];
}

export function getDefaultSuperAdminCredentials() {
  return {
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    password: DEFAULT_SUPER_ADMIN_SECRET,
  };
}

export function setSuperAdminPassword(newPassword: string) {
  const state = readState();
  const key = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
  if (state.users[key]) {
    state.users[key].secret = newPassword;
    state.users[key].updatedAt = new Date().toISOString();
    saveState(state);
    addLog("PASSWORD_CHANGED", DEFAULT_SUPER_ADMIN_USERNAME, "Super admin password updated");
    return { success: true as const, message: "Password updated successfully." };
  }
  return { success: false as const, error: "Super admin user not found." };
}

(window as unknown as { setSuperAdminPassword: typeof setSuperAdminPassword }).setSuperAdminPassword = setSuperAdminPassword;

export function getAuthSession() {
  const state = readState();
  return state.session;
}

export function isSuperAdmin(session: AuthSession | null): boolean {
  return session?.role === "super_admin";
}

export function login(username: string, password: string) {
  const state = readState();
  const user = state.users[normalizeUsername(username)];

  if (!user) {
    addLog("LOGIN_FAILED", username, "User not found");
    return { success: false as const, error: "No account matches that username." };
  }

  if (!user.active) {
    addLog("LOGIN_FAILED", username, "Account disabled");
    return { success: false as const, error: "This account has been disabled." };
  }

  if (user.secret !== password) {
    addLog("LOGIN_FAILED", username, "Incorrect password");
    return { success: false as const, error: "Incorrect password." };
  }

  const session: AuthSession = {
    username: user.username,
    role: user.role,
    name: user.name || "",
    surname: user.surname || "",
    coversheetCode: user.coversheetCode || "",
    loggedInAt: new Date().toISOString(),
  };

  // Update last login
  user.lastLogin = new Date().toISOString();
  state.session = session;
  saveState(state);

  addLog("LOGIN_SUCCESS", username, `Logged in as ${user.role}`);
  return { success: true as const, session };
}

export function logout() {
  const state = readState();
  if (state.session) {
    addLog("LOGOUT", state.session.username);
  }
  state.session = null;
  saveState(state);
}

export function getUsers(): AuthUser[] {
  const state = readState();
  return Object.values(state.users);
}

export function getUser(username: string): AuthUser | null {
  const state = readState();
  return state.users[normalizeUsername(username)] || null;
}

export function createUser(
  requestingSession: AuthSession,
  userData: { username: string; password: string; role: AuthRole; name: string; surname: string }
) {
  if (requestingSession.role !== "super_admin") {
    return { success: false as const, error: "Only super admins can create users." };
  }

  if (!canManageRole(requestingSession.role, userData.role)) {
    return { success: false as const, error: "You cannot create users with this role level." };
  }

  const state = readState();
  const key = normalizeUsername(userData.username);

  if (state.users[key]) {
    return { success: false as const, error: "A user with this username already exists." };
  }

  const now = new Date().toISOString();
  const newUser: AuthUser = {
    username: userData.username.toLowerCase(),
    secret: userData.password,
    role: userData.role,
    name: userData.name,
    surname: userData.surname,
    createdAt: now,
    updatedAt: now,
    active: true,
  };

  state.users[key] = newUser;
  saveState(state);

  addLog("USER_CREATED", requestingSession.username, `Created user: ${userData.username} (${userData.role})`);
  return { success: true as const, user: newUser };
}

export function updateUser(
  requestingSession: AuthSession,
  targetUsername: string,
  updates: { name?: string; surname?: string; role?: AuthRole; active?: boolean }
) {
  if (requestingSession.role !== "super_admin") {
    return { success: false as const, error: "Only super admins can update users." };
  }

  const state = readState();
  const key = normalizeUsername(targetUsername);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  if (user.role === "super_admin" && requestingSession.username !== targetUsername) {
    return { success: false as const, error: "Cannot modify another super admin." };
  }

  if (updates.role && !canManageRole(requestingSession.role, updates.role)) {
    return { success: false as const, error: "Cannot assign this role level." };
  }

  if (updates.name) user.name = updates.name;
  if (updates.surname) user.surname = updates.surname;
  if (updates.role) user.role = updates.role;
  if (updates.active !== undefined) user.active = updates.active;
  user.updatedAt = new Date().toISOString();

  saveState(state);
  addLog("USER_UPDATED", requestingSession.username, `Updated user: ${targetUsername}`);

  return { success: true as const, user };
}

export function resetUserPassword(requestingSession: AuthSession, targetUsername: string, newPassword: string) {
  if (requestingSession.role !== "super_admin") {
    return { success: false as const, error: "Only super admins can reset passwords." };
  }

  const state = readState();
  const key = normalizeUsername(targetUsername);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  if (user.role === "super_admin" && requestingSession.username !== targetUsername) {
    return { success: false as const, error: "Cannot reset another super admin's password." };
  }

  user.secret = newPassword;
  user.updatedAt = new Date().toISOString();
  saveState(state);

  addLog("PASSWORD_RESET", requestingSession.username, `Reset password for: ${targetUsername}`);
  return { success: true as const, message: "Password has been reset." };
}

export function deleteUser(requestingSession: AuthSession, targetUsername: string) {
  if (requestingSession.role !== "super_admin") {
    return { success: false as const, error: "Only super admins can delete users." };
  }

  const state = readState();
  const key = normalizeUsername(targetUsername);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  if (user.role === "super_admin") {
    return { success: false as const, error: "Cannot delete super admin accounts." };
  }

  if (requestingSession.username === targetUsername) {
    return { success: false as const, error: "Cannot delete your own account." };
  }

  delete state.users[key];
  saveState(state);

  addLog("USER_DELETED", requestingSession.username, `Deleted user: ${targetUsername}`);
  return { success: true as const, message: "User deleted successfully." };
}

export function updateOwnPassword(session: AuthSession, currentPassword: string, newPassword: string) {
  const state = readState();
  const user = state.users[normalizeUsername(session.username)];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  if (user.secret !== currentPassword) {
    return { success: false as const, error: "Current password is incorrect." };
  }

  user.secret = newPassword;
  user.updatedAt = new Date().toISOString();
  saveState(state);

  addLog("PASSWORD_CHANGED", session.username);
  return { success: true as const, message: "Password changed successfully." };
}

export function getLogs(): Array<{ timestamp: string; action: string; user?: string; details: string }> {
  const state = readState();
  return state.logs;
}

export function clearLogs() {
  const state = readState();
  state.logs = [];
  saveState(state);
  return { success: true };
}

export function registerRep(userData: { username: string; password: string; name: string; surname: string; coversheetCode?: string }) {
  const key = normalizeUsername(userData.username);

  if (!userData.username || !userData.password || !userData.name || !userData.surname) {
    return { success: false as const, error: "All fields are required." };
  }

  if (userData.password.length < 4) {
    return { success: false as const, error: "Password must be at least 4 characters." };
  }

  const state = readState();

  if (state.users[key]) {
    return { success: false as const, error: "An account with this email already exists." };
  }

  const now = new Date().toISOString();
  const newUser: AuthUser = {
    username: userData.username.toLowerCase(),
    secret: userData.password,
    role: "rep",
    name: userData.name,
    surname: userData.surname,
    coversheetCode: String(userData.coversheetCode || "").trim(),
    createdAt: now,
    updatedAt: now,
    active: true,
  };

  state.users[key] = newUser;
  saveState(state);

  addLog("USER_REGISTERED", userData.username, "Self-registered as rep");
  return { success: true as const, user: newUser };
}

export function updateUserProfile(
  username: string,
  name: string,
  surname: string,
  options?: { coversheetCode?: string | null }
) {
  const state = readState();
  const key = normalizeUsername(username);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  user.name = name.trim();
  user.surname = surname.trim();
  if (options && "coversheetCode" in options) {
    user.coversheetCode = String(options.coversheetCode || "").trim();
  }
  user.updatedAt = new Date().toISOString();

  if (state.session && normalizeUsername(state.session.username) === key) {
    state.session.name = name.trim();
    state.session.surname = surname.trim();
    state.session.coversheetCode = user.coversheetCode || "";
  }

  saveState(state);
  addLog("PROFILE_UPDATED", username);
  return { success: true as const, session: state.session, message: "Profile updated successfully." };
}

const APP_STORAGE_KEYS = [
  "pfm-auth-state-v2",
  "employee-profiles-cache-v1",
  "attendance-records-cache-v1",
  "pfm-clock-cache-v1",
  "ipulse-config-v1",
  "ipulse-sync-logs-v1",
  "shift-roster-cache-v1",
  "shift-sync-settings-v1",
  "leave-applications-cache-v1",
  "leave-uploads-cache-v1",
  "employee-update-logs-v1",
  "pfm-trial-reset-v1",
  "calendar-events-v1",
];

export async function clearAllAppData() {
  if (typeof window === "undefined" || !window.localStorage) {
    return { success: false, message: "Cannot access localStorage" };
  }
  
  // Clear localStorage
  let cleared = 0;
  for (const key of APP_STORAGE_KEYS) {
    if (window.localStorage.getItem(key)) {
      window.localStorage.removeItem(key);
      cleared++;
    }
  }
  
  // Clear IndexedDB databases
  const idbDatabases = ["time-attendance-employee-db", "clock-events-db"];
  for (const dbName of idbDatabases) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = window.indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => { cleared++; resolve(); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    } catch (e) {
      // Ignore errors for databases that don't exist
    }
  }
  
  // Clear all remaining localStorage (except calendar)
  const keysToPreserve = ["calendar-events-v1", "pfm-auth-state-v2"];
  const allKeys = Object.keys(window.localStorage);
  for (const key of allKeys) {
    if (!keysToPreserve.includes(key)) {
      window.localStorage.removeItem(key);
      cleared++;
    }
  }
  
  return { success: true, message: `Cleared ${cleared} storage items. Calendar preserved.` };
}

(window as unknown as { clearAllAppData: typeof clearAllAppData }).clearAllAppData = clearAllAppData;
