import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Employee } from "@/services/database";
import { getEmployees, normalizeEmployeeCode } from "@/services/database";
import { getUsers, type AuthRole } from "@/services/auth";
import { loadStoredCoversheetData } from "@/services/coversheetStorage";
import { buildTeamAssignmentMatcher, getEmployeeScopeInfo, getTeamScopeInfo, normalizeScopeCompare, normalizeScopeText } from "@/services/teamScope";

export type StoreAssignment = {
  username: string;
  storeKeys: string[];
  updatedAt: string;
};

export type StoreInfo = {
  storeKey: string;
  storeName: string;
  storeCode: string;
  region: string;
  regionCode: string;
  employeeCount: number;
};

const STORAGE_KEY = "pfm-store-assignments-v1";
const COVERSHEET_ASSIGNMENT_PREFIX = "coversheet:";

function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
}

function stripTrailingBracketCode(value: string) {
  return value.replace(/\s*\(([^)]+)\)\s*$/, "").trim();
}

function normalizeNameForJoin(value: unknown) {
  return stripTrailingBracketCode(normalizeScopeText(value)).toLowerCase();
}

function collectCodeCandidates(...values: unknown[]) {
  const codes = new Set<string>();

  values.forEach((value) => {
    const text = normalizeScopeText(value);
    if (!text) return;

    const leading = text.match(/^([A-Za-z0-9]+)\s*-\s*/);
    if (leading?.[1]) codes.add(leading[1].toLowerCase());

    const trailing = text.match(/\(([^)]+)\)\s*$/);
    if (trailing?.[1]) codes.add(trailing[1].trim().toLowerCase());

    if (/^[A-Za-z0-9]+$/.test(text)) codes.add(text.toLowerCase());
  });

  return codes;
}

function buildCoversheetAssignmentKey(storeCode: unknown, storeName: unknown) {
  const code = normalizeScopeText(storeCode);
  const name = normalizeScopeText(storeName);
  const info = getTeamScopeInfo(`${code ? `${code} - ` : ""}${name}`, name, code);
  const normalizedCode = normalizeScopeCompare(code);
  return `${COVERSHEET_ASSIGNMENT_PREFIX}${normalizedCode ? `${normalizedCode}__` : ""}${info.key}`;
}

function isCoversheetAssignmentKey(value: string) {
  return String(value || "").trim().toLowerCase().startsWith(COVERSHEET_ASSIGNMENT_PREFIX);
}

function normalizeCoversheetAssignmentKey(value: string) {
  const text = String(value || "").trim();
  return text.toLowerCase().startsWith(COVERSHEET_ASSIGNMENT_PREFIX) ? text.slice(COVERSHEET_ASSIGNMENT_PREFIX.length) : text;
}

function getCoversheetAssignmentLabel(value: string) {
  return normalizeCoversheetAssignmentKey(value).replace(/^[a-z0-9]+__/, "");
}

type CoversheetResolutionEntry = {
  assignmentKey: string;
  legacyKeys: Set<string>;
  teamKeys: Set<string>;
};

function storeMatchesAssignment(storeCode: unknown, storeName: unknown, assignmentKey: string) {
  const normalizedAssignment = normalizeScopeCompare(getCoversheetAssignmentLabel(assignmentKey));
  if (!normalizedAssignment) return false;

  const combined = getTeamScopeInfo(`${normalizeScopeText(storeCode) ? `${normalizeScopeText(storeCode)} - ` : ""}${normalizeScopeText(storeName)}`, storeName, storeCode);
  const names = new Set([normalizeNameForJoin(storeName), normalizeNameForJoin(combined.label), normalizeNameForJoin(combined.name)].filter(Boolean));
  const codes = collectCodeCandidates(storeCode, storeName, combined.code);
  const assignmentCodes = collectCodeCandidates(normalizeCoversheetAssignmentKey(assignmentKey).replace(/__/g, " "));
  const assignmentName = normalizeNameForJoin(getCoversheetAssignmentLabel(assignmentKey));

  if (normalizedAssignment === combined.key) return true;
  if (assignmentName && names.has(assignmentName)) {
    if (assignmentCodes.size === 0 || codes.size === 0) return true;
    for (const code of assignmentCodes) {
      if (codes.has(code)) return true;
    }
  }

  return false;
}

function buildTeamUniverse(employees: Employee[]) {
  const storeMap = new Map<string, StoreInfo>();

  for (const emp of employees) {
    const scope = getEmployeeScopeInfo(emp);
    if (!scope.key) continue;
    if (!storeMap.has(scope.key)) {
      storeMap.set(scope.key, {
        storeKey: scope.key,
        storeName: scope.name || scope.label,
        storeCode: scope.code,
        region: emp.region || "",
        regionCode: "",
        employeeCount: 0,
      });
    }
    storeMap.get(scope.key)!.employeeCount++;
  }

  return Array.from(storeMap.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
}

async function buildCoversheetResolutionEntries(employees: Employee[]) {
  const coversheetData = await loadStoredCoversheetData();
  if (!coversheetData?.stores?.length) return [];

  const employeesByCode = new Map(
    employees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee])
  );
  const teamUniverse = buildTeamUniverse(employees);

  return coversheetData.stores.map((store) => {
    const assignmentKey = buildCoversheetAssignmentKey(store.storeCode, store.storeName);
    const teamKeys = new Set<string>();
    const legacyKeys = new Set<string>();
    const storeCode = normalizeScopeText(store.storeCode);
    const storeName = normalizeScopeText(store.storeName);

    legacyKeys.add(assignmentKey);
    if (storeName) legacyKeys.add(storeName);
    if (storeCode && storeName) legacyKeys.add(`${storeCode} - ${storeName}`);

    (store.employees || []).forEach((entry) => {
      const rawCode = "employeeCode" in (entry as Record<string, unknown>) ? (entry as { employeeCode?: unknown }).employeeCode : undefined;
      const employee = employeesByCode.get(normalizeEmployeeCode(rawCode));
      if (!employee) return;
      const scope = getEmployeeScopeInfo(employee);
      if (scope.key) teamKeys.add(scope.key);
    });

    if (teamKeys.size === 0) {
      teamUniverse.forEach((team) => {
        if (storeMatchesAssignment(store.storeCode, store.storeName, team.storeKey)) {
          teamKeys.add(team.storeKey);
        }
      });
    }

    return {
      assignmentKey,
      legacyKeys,
      teamKeys,
    } satisfies CoversheetResolutionEntry;
  });
}

async function resolveAssignedKeysToTeamKeys(assignedKeys: string[]) {
  const employees = await getEmployees();
  const resolvedTeamKeys = new Set<string>();

  const coversheetEntries = await buildCoversheetResolutionEntries(employees);
  assignedKeys.forEach((assignedKey) => {
    if (!isCoversheetAssignmentKey(assignedKey)) {
      const directMatcher = buildTeamAssignmentMatcher([assignedKey]);
      buildTeamUniverse(employees).forEach((team) => {
        if (directMatcher(team.storeKey) || directMatcher(`${team.storeCode ? `${team.storeCode} - ` : ""}${team.storeName}`)) {
          resolvedTeamKeys.add(team.storeKey);
        }
      });
      return;
    }

    const matchedEntry = coversheetEntries.find(
      (entry) =>
        entry.legacyKeys.has(assignedKey) ||
        (isCoversheetAssignmentKey(assignedKey) && normalizeScopeCompare(assignedKey) === normalizeScopeCompare(entry.assignmentKey)) ||
        storeMatchesAssignment("", assignedKey, entry.assignmentKey) ||
        storeMatchesAssignment("", normalizeCoversheetAssignmentKey(assignedKey), entry.assignmentKey)
    );
    matchedEntry?.teamKeys.forEach((teamKey) => resolvedTeamKeys.add(teamKey));
  });

  return Array.from(resolvedTeamKeys);
}

export async function getAssignableStoresForRole(role: AuthRole): Promise<StoreInfo[]> {
  const employees = await getEmployees();
  if (role !== "rep") {
    return buildTeamUniverse(employees);
  }

  const entries = await buildCoversheetResolutionEntries(employees);
  if (entries.length === 0) {
    return buildTeamUniverse(employees);
  }

  const coversheetData = await loadStoredCoversheetData();
  const stores = coversheetData?.stores || [];

  return stores
    .map((store) => {
      const assignmentKey = buildCoversheetAssignmentKey(store.storeCode, store.storeName);
      const resolutionEntry = entries.find((entry) => entry.assignmentKey === assignmentKey);
      return {
        storeKey: assignmentKey,
        storeName: normalizeScopeText(store.storeName) || "Unknown Store",
        storeCode: normalizeScopeText(store.storeCode),
        region: `${resolutionEntry?.teamKeys.size || 0} matched team${resolutionEntry?.teamKeys.size === 1 ? "" : "s"}`,
        regionCode: "",
        employeeCount: Array.isArray(store.employees) ? store.employees.length : 0,
      } satisfies StoreInfo;
    })
    .sort((a, b) => `${a.storeCode} ${a.storeName}`.trim().localeCompare(`${b.storeCode} ${b.storeName}`.trim()));
}

export async function getStoreAssignments(username: string): Promise<string[]> {
  const localAssignments = loadLocalAssignments();
  const entry = localAssignments.find((a) => normalizeUsername(a.username) === normalizeUsername(username));
  if (entry) return entry.storeKeys;

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("store_assignments")
        .select("store_keys")
        .eq("username", normalizeUsername(username))
        .maybeSingle();
      if (!error && data?.store_keys) {
        return Array.isArray(data.store_keys) ? data.store_keys : [];
      }
    } catch {
      // fallback to local
    }
  }

  return [];
}

export async function saveStoreAssignments(username: string, storeKeys: string[]): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const localAssignments = loadLocalAssignments();
  const normalizedUsername = normalizeUsername(username);
  const existingIndex = localAssignments.findIndex((a) => normalizeUsername(a.username) === normalizedUsername);

  if (existingIndex >= 0) {
    localAssignments[existingIndex] = { username: normalizedUsername, storeKeys, updatedAt: now };
  } else {
    localAssignments.push({ username: normalizedUsername, storeKeys, updatedAt: now });
  }

  saveLocalAssignments(localAssignments);

  if (isSupabaseConfigured) {
    try {
      const { error } = await supabase
        .from("store_assignments")
        .upsert(
          { username: normalizedUsername, store_keys: storeKeys, updated_at: now },
          { onConflict: "username" }
        );
      if (error) {
        console.warn("Failed to save store assignments to Supabase:", error.message);
      }
    } catch (e) {
      console.warn("Exception saving store assignments:", e);
    }
  }

  return { success: true };
}

export async function getResolvedStoreAssignments(username: string, role: AuthRole): Promise<string[]> {
  const ownAssignments = await getStoreAssignments(username);
  if (role === "rep") return resolveAssignedKeysToTeamKeys(ownAssignments);

  const users = await getUsers();
  const userByName = new Map(users.map((user) => [normalizeUsername(user.username), user]));
  const storeKeys = new Set<string>();

  const addUserStores = async (targetUsername: string) => {
    const target = userByName.get(normalizeUsername(targetUsername));
    if (!target) return;

    if (target.role === "rep") {
      const repStores = await getResolvedStoreAssignments(target.username, "rep");
      repStores.forEach((key) => storeKeys.add(key));
      return;
    }

    if (target.role === "regional") {
      const repUsernames = await getStoreAssignments(target.username);
      for (const repUsername of repUsernames) {
        const rep = userByName.get(normalizeUsername(repUsername));
        if (rep?.role === "rep") {
          const repStores = await getResolvedStoreAssignments(rep.username, "rep");
          repStores.forEach((key) => storeKeys.add(key));
        }
      }
    }
  };

  if (role === "regional") {
    for (const repUsername of ownAssignments) {
      const rep = userByName.get(normalizeUsername(repUsername));
      if (rep?.role === "rep") {
        const repStores = await getResolvedStoreAssignments(rep.username, "rep");
        repStores.forEach((key) => storeKeys.add(key));
      }
    }
  }

  if (role === "divisional") {
    for (const regionalUsername of ownAssignments) {
      await addUserStores(regionalUsername);
    }
  }

  return Array.from(storeKeys);
}

export function getAllAssignments(): StoreAssignment[] {
  return loadLocalAssignments();
}

export async function getAssignedEmployees(username: string): Promise<Employee[]> {
  const users = await getUsers();
  const matchedUser = users.find((user) => normalizeUsername(user.username) === normalizeUsername(username));
  const assignedStoreKeys = matchedUser ? await getResolvedStoreAssignments(username, matchedUser.role) : await getStoreAssignments(username);
  if (assignedStoreKeys.length === 0) return [];

  const allEmployees = await getEmployees();
  const matcher = buildTeamAssignmentMatcher(assignedStoreKeys);
  return allEmployees.filter((emp) => matcher(emp));
}

export async function getAllStores(): Promise<StoreInfo[]> {
  const allEmployees = await getEmployees();
  return buildTeamUniverse(allEmployees);
}

function loadLocalAssignments(): StoreAssignment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveLocalAssignments(assignments: StoreAssignment[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // ignore
  }
}
