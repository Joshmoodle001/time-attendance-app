const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const TABLE = "shift_sync_settings";
const USER_PREFIX = "auth-user:";
const ROOT_USERNAME = "josh@pfm.co.za";
const ROOT_PASSWORD = "1234";

const ROLE_HIERARCHY = {
  super_admin: 5,
  admin: 4,
  divisional: 3,
  regional: 2,
  rep: 1,
};

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function isRootSuperAdminUsername(username) {
  return normalizeUsername(username) === normalizeUsername(ROOT_USERNAME);
}

function canManageRole(requestingRole, targetRole) {
  return (ROLE_HIERARCHY[requestingRole] || 0) > (ROLE_HIERARCHY[targetRole] || 0);
}

function userRowId(username) {
  return `${USER_PREFIX}${normalizeUsername(username)}`;
}

function buildDefaultRootUser() {
  const now = new Date().toISOString();
  return {
    username: ROOT_USERNAME,
    secret: ROOT_PASSWORD,
    role: "super_admin",
    name: "Josh",
    surname: "Moodle",
    coversheetCode: "",
    createdAt: now,
    updatedAt: now,
    active: true,
  };
}

function normalizeUserRecord(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const username = normalizeUsername(payload.username || row?.id?.slice(USER_PREFIX.length) || "");
  if (!username) return null;

  const createdAt = payload.createdAt || row?.updated_at || new Date().toISOString();
  const updatedAt = payload.updatedAt || row?.updated_at || createdAt;

  return {
    username,
    secret: String(payload.secret || ""),
    role: isRootSuperAdminUsername(username) ? "super_admin" : payload.role || "rep",
    name: String(payload.name || ""),
    surname: String(payload.surname || ""),
    coversheetCode: String(payload.coversheetCode || ""),
    createdAt,
    updatedAt,
    lastLogin: payload.lastLogin || undefined,
    active: payload.active !== false,
  };
}

function toRow(user) {
  return {
    id: userRowId(user.username),
    auto_sync_enabled: false,
    last_universal_synced_at: null,
    last_universal_status: "auth_user",
    payload: {
      username: normalizeUsername(user.username),
      secret: String(user.secret || ""),
      role: isRootSuperAdminUsername(user.username) ? "super_admin" : user.role,
      name: String(user.name || ""),
      surname: String(user.surname || ""),
      coversheetCode: String(user.coversheetCode || ""),
      createdAt: user.createdAt || new Date().toISOString(),
      updatedAt: user.updatedAt || new Date().toISOString(),
      lastLogin: user.lastLogin || null,
      active: user.active !== false,
    },
    updated_at: user.updatedAt || new Date().toISOString(),
  };
}

async function supabaseFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase server configuration is missing.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase request failed with ${response.status}`);
  }
  return data;
}

async function getUserByUsername(username) {
  const rows = await supabaseFetch(
    `${TABLE}?id=eq.${encodeURIComponent(userRowId(username))}&select=id,payload,updated_at`
  );
  return normalizeUserRecord(Array.isArray(rows) ? rows[0] : null);
}

async function listUsers() {
  const rows = await supabaseFetch(
    `${TABLE}?id=like.${encodeURIComponent(`${USER_PREFIX}*`)}&select=id,payload,updated_at&order=updated_at.desc`
  );
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeUserRecord)
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function upsertUser(user) {
  const [row] = await supabaseFetch(`${TABLE}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([toRow(user)]),
  });
  return normalizeUserRecord(row);
}

async function deleteUserRow(username) {
  await supabaseFetch(`${TABLE}?id=eq.${encodeURIComponent(userRowId(username))}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });
}

async function ensureRootSuperAdmin() {
  const existing = await getUserByUsername(ROOT_USERNAME);
  if (existing) {
    if (existing.role !== "super_admin" || existing.secret !== ROOT_PASSWORD || existing.active !== true) {
      return upsertUser({
        ...existing,
        secret: ROOT_PASSWORD,
        role: "super_admin",
        active: true,
        updatedAt: new Date().toISOString(),
      });
    }
    return existing;
  }

  return upsertUser(buildDefaultRootUser());
}

function buildSession(user, loggedInAt) {
  return {
    username: user.username,
    role: isRootSuperAdminUsername(user.username) ? "super_admin" : user.role,
    name: user.name || "",
    surname: user.surname || "",
    coversheetCode: user.coversheetCode || "",
    loggedInAt: loggedInAt || new Date().toISOString(),
  };
}

function verifySuperAdmin(requester) {
  return requester && requester.role === "super_admin";
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  try {
    await ensureRootSuperAdmin();

    if (req.method === "GET") {
      const username = normalizeUsername(req.query?.username || "");
      if (username) {
        const user = await getUserByUsername(username);
        return res.status(200).json({ success: true, user });
      }

      const users = await listUsers();
      return res.status(200).json({ success: true, users });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const body = await readJsonBody(req);
    const action = String(body?.action || "").trim();

    if (action === "ensureSeed") {
      return res.status(200).json({ success: true });
    }

    if (action === "syncLegacy") {
      const users = Array.isArray(body?.users) ? body.users : [];
      for (const entry of users) {
        const normalized = normalizeUserRecord({ payload: entry, updated_at: entry?.updatedAt });
        if (!normalized) continue;
        const existing = await getUserByUsername(normalized.username);
        if (!existing) {
          await upsertUser(normalized);
        }
      }
      return res.status(200).json({ success: true });
    }

    if (action === "login") {
      const username = normalizeUsername(body?.username || "");
      const password = String(body?.password || "");
      const user = await getUserByUsername(username);

      if (!user) {
        return res.status(404).json({ success: false, error: "No account matches that username." });
      }
      if (!user.active) {
        return res.status(403).json({ success: false, error: "This account has been disabled." });
      }
      if (user.secret !== password) {
        return res.status(401).json({ success: false, error: "Incorrect password." });
      }

      const updatedUser = await upsertUser({
        ...user,
        lastLogin: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({
        success: true,
        session: buildSession(updatedUser, new Date().toISOString()),
      });
    }

    if (action === "refreshSession") {
      const username = normalizeUsername(body?.username || "");
      const user = await getUserByUsername(username);
      if (!user || !user.active) {
        return res.status(200).json({ success: true, session: null });
      }

      return res.status(200).json({ success: true, session: buildSession(user, body?.loggedInAt) });
    }

    if (action === "registerRep") {
      const userData = body?.userData || {};
      const username = normalizeUsername(userData.username || "");
      const password = String(userData.password || "");
      const name = String(userData.name || "").trim();
      const surname = String(userData.surname || "").trim();
      const coversheetCode = String(userData.coversheetCode || "").trim();

      if (!username || !password || !name || !surname) {
        return res.status(400).json({ success: false, error: "All fields are required." });
      }
      if (password.length < 4) {
        return res.status(400).json({ success: false, error: "Password must be at least 4 characters." });
      }

      const existing = await getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ success: false, error: "An account with this email already exists." });
      }

      const now = new Date().toISOString();
      const user = await upsertUser({
        username,
        secret: password,
        role: "rep",
        name,
        surname,
        coversheetCode,
        createdAt: now,
        updatedAt: now,
        active: true,
      });

      return res.status(200).json({ success: true, user });
    }

    if (action === "createUser") {
      const requester = body?.requester || {};
      const userData = body?.userData || {};

      if (!verifySuperAdmin(requester)) {
        return res.status(403).json({ success: false, error: "Only super admins can create users." });
      }
      if (!isRootSuperAdminUsername(requester.username) && !canManageRole(requester.role, userData.role)) {
        return res.status(403).json({ success: false, error: "You cannot create users with this role level." });
      }

      const username = normalizeUsername(userData.username || "");
      if (!username) {
        return res.status(400).json({ success: false, error: "Username is required." });
      }
      const existing = await getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ success: false, error: "A user with this username already exists." });
      }

      const now = new Date().toISOString();
      const user = await upsertUser({
        username,
        secret: String(userData.password || ""),
        role: userData.role || "rep",
        name: String(userData.name || ""),
        surname: String(userData.surname || ""),
        coversheetCode: "",
        createdAt: now,
        updatedAt: now,
        active: true,
      });

      return res.status(200).json({ success: true, user });
    }

    if (action === "updateUser") {
      const requester = body?.requester || {};
      const targetUsername = normalizeUsername(body?.targetUsername || "");
      const updates = body?.updates || {};

      if (!verifySuperAdmin(requester)) {
        return res.status(403).json({ success: false, error: "Only super admins can update users." });
      }

      const user = await getUserByUsername(targetUsername);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      if (user.role === "super_admin" && !isRootSuperAdminUsername(requester.username) && normalizeUsername(requester.username) !== targetUsername) {
        return res.status(403).json({ success: false, error: "Cannot modify another super admin." });
      }

      if (updates.role && !isRootSuperAdminUsername(requester.username) && !canManageRole(requester.role, updates.role)) {
        return res.status(403).json({ success: false, error: "Cannot assign this role level." });
      }

      const next = await upsertUser({
        ...user,
        name: updates.name !== undefined ? String(updates.name) : user.name,
        surname: updates.surname !== undefined ? String(updates.surname) : user.surname,
        role: updates.role || user.role,
        active: updates.active !== undefined ? Boolean(updates.active) : user.active,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ success: true, user: next });
    }

    if (action === "resetPassword") {
      const requester = body?.requester || {};
      const targetUsername = normalizeUsername(body?.targetUsername || "");
      const newPassword = String(body?.newPassword || "");

      if (!verifySuperAdmin(requester)) {
        return res.status(403).json({ success: false, error: "Only super admins can reset passwords." });
      }

      const user = await getUserByUsername(targetUsername);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      if (user.role === "super_admin" && !isRootSuperAdminUsername(requester.username) && normalizeUsername(requester.username) !== targetUsername) {
        return res.status(403).json({ success: false, error: "Cannot reset another super admin's password." });
      }

      await upsertUser({
        ...user,
        secret: newPassword,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ success: true, message: "Password has been reset." });
    }

    if (action === "deleteUser") {
      const requester = body?.requester || {};
      const targetUsername = normalizeUsername(body?.targetUsername || "");

      if (!verifySuperAdmin(requester)) {
        return res.status(403).json({ success: false, error: "Only super admins can delete users." });
      }
      if (isRootSuperAdminUsername(targetUsername)) {
        return res.status(403).json({ success: false, error: "Cannot delete the root super admin account." });
      }
      if (normalizeUsername(requester.username) === targetUsername) {
        return res.status(403).json({ success: false, error: "Cannot delete your own account." });
      }

      const user = await getUserByUsername(targetUsername);
      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }
      if (user.role === "super_admin" && !isRootSuperAdminUsername(requester.username)) {
        return res.status(403).json({ success: false, error: "Cannot delete super admin accounts." });
      }

      await deleteUserRow(targetUsername);
      return res.status(200).json({ success: true, message: "User deleted successfully." });
    }

    if (action === "updateOwnPassword") {
      const requester = body?.requester || {};
      const currentPassword = String(body?.currentPassword || "");
      const newPassword = String(body?.newPassword || "");
      const user = await getUserByUsername(requester.username);

      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }
      if (user.secret !== currentPassword) {
        return res.status(401).json({ success: false, error: "Current password is incorrect." });
      }

      await upsertUser({
        ...user,
        secret: newPassword,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ success: true, message: "Password changed successfully." });
    }

    if (action === "updateProfile") {
      const username = normalizeUsername(body?.username || "");
      const user = await getUserByUsername(username);

      if (!user) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      const next = await upsertUser({
        ...user,
        name: String(body?.name || "").trim(),
        surname: String(body?.surname || "").trim(),
        coversheetCode: String(body?.coversheetCode || "").trim(),
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ success: true, user: next });
    }

    return res.status(400).json({ success: false, error: "Unknown auth action." });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown auth error",
    });
  }
}
