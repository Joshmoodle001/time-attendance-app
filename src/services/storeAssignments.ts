import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Employee } from "@/services/database";
import { getEmployees } from "@/services/database";
import { getUsers, type AuthRole } from "@/services/auth";
import { buildTeamAssignmentMatcher, getEmployeeScopeInfo } from "@/services/teamScope";

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

function normalizeUsername(value: string) {
  return String(value || "").trim().toLowerCase();
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
  if (role === "rep") return ownAssignments;

  const users = await getUsers();
  const userByName = new Map(users.map((user) => [normalizeUsername(user.username), user]));
  const storeKeys = new Set<string>();

  const addUserStores = async (targetUsername: string) => {
    const target = userByName.get(normalizeUsername(targetUsername));
    if (!target) return;

    if (target.role === "rep") {
      const repStores = await getStoreAssignments(target.username);
      repStores.forEach((key) => storeKeys.add(key));
      return;
    }

    if (target.role === "regional") {
      const repUsernames = await getStoreAssignments(target.username);
      for (const repUsername of repUsernames) {
        const rep = userByName.get(normalizeUsername(repUsername));
        if (rep?.role === "rep") {
          const repStores = await getStoreAssignments(rep.username);
          repStores.forEach((key) => storeKeys.add(key));
        }
      }
    }
  };

  if (role === "regional") {
    for (const repUsername of ownAssignments) {
      const rep = userByName.get(normalizeUsername(repUsername));
      if (rep?.role === "rep") {
        const repStores = await getStoreAssignments(rep.username);
        repStores.forEach((key) => storeKeys.add(key));
      } else {
        storeKeys.add(repUsername);
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
  const assignedStoreKeys = await getStoreAssignments(username);
  if (assignedStoreKeys.length === 0) return [];

  const allEmployees = await getEmployees();
  const matcher = buildTeamAssignmentMatcher(assignedStoreKeys);
  return allEmployees.filter((emp) => matcher(emp));
}

export async function getAllStores(): Promise<StoreInfo[]> {
  const allEmployees = await getEmployees();
  const storeMap = new Map<string, StoreInfo>();

  for (const emp of allEmployees) {
    const scope = getEmployeeScopeInfo(emp);
    const storeKey = scope.key;
    if (!storeKey) continue;
    if (!storeMap.has(storeKey)) {
      storeMap.set(storeKey, {
        storeKey,
        storeName: scope.name || scope.label,
        storeCode: scope.code,
        region: emp.region || "",
        regionCode: "",
        employeeCount: 0,
      });
    }
    storeMap.get(storeKey)!.employeeCount++;
  }

  return Array.from(storeMap.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
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
