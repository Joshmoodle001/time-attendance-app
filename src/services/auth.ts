export type AuthRole = "super_admin";

export type AuthUser = {
  username: string;
  secret: string;
  role: AuthRole;
  name: string;
  surname: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  username: string;
  role: AuthRole;
  name: string;
  surname: string;
  loggedInAt: string;
};

type AuthState = {
  users: Record<string, AuthUser>;
  session: AuthSession | null;
};

const STORAGE_KEY = "pfm-auth-state-v1";
export const DEFAULT_SUPER_ADMIN_USERNAME = ["Josh", "pfm.co.za"].join("@");
export const DEFAULT_SUPER_ADMIN_SECRET = "PFM@dmin2026!";

function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

function createDefaultSuperAdmin(): AuthUser {
  const now = new Date().toISOString();
  return {
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    secret: DEFAULT_SUPER_ADMIN_SECRET,
    role: "super_admin",
    name: "Josh",
    surname: "Moodle",
    createdAt: now,
    updatedAt: now,
  };
}

function getFallbackState(): AuthState {
  const defaultAdmin = createDefaultSuperAdmin();
  return {
    users: {
      [normalizeUsername(defaultAdmin.username)]: defaultAdmin,
    },
    session: null,
  };
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function saveState(state: AuthState) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readState(): AuthState {
  if (!canUseStorage()) return getFallbackState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const next = getFallbackState();
      saveState(next);
      return next;
    }

    const parsed = JSON.parse(raw) as Partial<AuthState>;
    const next: AuthState = {
      users: parsed?.users && typeof parsed.users === "object" ? parsed.users as Record<string, AuthUser> : {},
      session: parsed?.session ?? null,
    };

    const defaultKey = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
    if (!next.users[defaultKey]) {
      next.users[defaultKey] = createDefaultSuperAdmin();
      saveState(next);
    } else if (next.users[defaultKey].secret !== DEFAULT_SUPER_ADMIN_SECRET) {
      // Ensure the default admin password stays in sync with the codebase default
      next.users[defaultKey].secret = DEFAULT_SUPER_ADMIN_SECRET;
      next.users[defaultKey].updatedAt = new Date().toISOString();
      saveState(next);
    }

    return next;
  } catch {
    const next = getFallbackState();
    saveState(next);
    return next;
  }
}

export function ensureSuperAdminSeeded() {
  const state = readState();
  const key = normalizeUsername(DEFAULT_SUPER_ADMIN_USERNAME);
  if (!state.users[key]) {
    state.users[key] = createDefaultSuperAdmin();
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

export function getAuthSession() {
  const state = readState();
  return state.session;
}

export function loginSuperAdmin(username: string, password: string) {
  const state = readState();
  const user = state.users[normalizeUsername(username)];

  if (!user) {
    return { success: false as const, error: "No account matches that username." };
  }

  if (user.secret !== password) {
    return { success: false as const, error: "Incorrect password." };
  }

  const session: AuthSession = {
    username: user.username,
    role: user.role,
    name: user.name || "",
    surname: user.surname || "",
    loggedInAt: new Date().toISOString(),
  };

  state.session = session;
  saveState(state);
  return { success: true as const, session };
}

export function logoutSuperAdmin() {
  const state = readState();
  state.session = null;
  saveState(state);
}

export function resetSuperAdminPassword(username: string, nextPassword: string) {
  const cleanPassword = String(nextPassword || "").trim();
  if (cleanPassword.length < 4) {
    return { success: false as const, error: "Password must be at least 4 characters." };
  }

  const state = readState();
  const key = normalizeUsername(username);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "That username could not be found." };
  }

  state.users[key] = {
    ...user,
    secret: cleanPassword,
    updatedAt: new Date().toISOString(),
  };
  state.session = null;
  saveState(state);

  return { success: true as const, message: "Password updated. Sign in with the new password." };
}

export function restoreDefaultSuperAdminPassword(username: string) {
  const state = readState();
  const key = normalizeUsername(username);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "That username could not be found." };
  }

  state.users[key] = {
    ...user,
    secret: DEFAULT_SUPER_ADMIN_SECRET,
    updatedAt: new Date().toISOString(),
  };
  state.session = null;
  saveState(state);

  return { success: true as const, message: "Password restored to the default super admin password." };
}

export function updateUserProfile(username: string, name: string, surname: string) {
  const state = readState();
  const key = normalizeUsername(username);
  const user = state.users[key];

  if (!user) {
    return { success: false as const, error: "User not found." };
  }

  state.users[key] = {
    ...user,
    name: name.trim(),
    surname: surname.trim(),
    updatedAt: new Date().toISOString(),
  };

  if (state.session && normalizeUsername(state.session.username) === key) {
    state.session.name = name.trim();
    state.session.surname = surname.trim();
  }

  saveState(state);
  return { 
    success: true as const, 
    session: state.session,
    message: "Profile updated successfully." 
  };
}
