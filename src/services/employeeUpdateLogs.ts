import { supabase } from "@/lib/supabase";
import type { EmployeeInput } from "@/services/database";

export type EmployeeUpdateReportItem = {
  employee_code: string;
  employee_name: string;
  change_type: "updated" | "inactive" | "unchanged" | "unmatched";
  changed_fields: string[];
};

export type EmployeeUpdateUploadLog = {
  id: string;
  file_name: string;
  upload_type?: string;
  matched_profiles: number;
  updated_profiles: number;
  inactive_profiles: number;
  unchanged_profiles: number;
  unmatched_rows: number;
  remote_message?: string;
  items: EmployeeUpdateReportItem[];
  rollback_employees?: EmployeeInput[];
  rolled_back_at?: string;
  created_at: string;
};

const EMPLOYEE_UPDATE_LOG_STORAGE_KEY = "employee-update-upload-logs-v1";
const EMPLOYEE_UPDATE_LOG_DB_NAME = "time-attendance-employee-update-log-db";
const EMPLOYEE_UPDATE_LOG_DB_VERSION = 1;
const EMPLOYEE_UPDATE_LOG_DB_STORE = "employee_update_upload_logs";

export const EMPLOYEE_UPDATE_LOGS_SETUP_SQL = `
CREATE TABLE IF NOT EXISTS employee_update_upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  upload_type TEXT DEFAULT 'emergency_upload_update',
  matched_profiles INTEGER NOT NULL DEFAULT 0,
  updated_profiles INTEGER NOT NULL DEFAULT 0,
  inactive_profiles INTEGER NOT NULL DEFAULT 0,
  unchanged_profiles INTEGER NOT NULL DEFAULT 0,
  unmatched_rows INTEGER NOT NULL DEFAULT 0,
  remote_message TEXT DEFAULT '',
  rolled_back_at TIMESTAMP WITH TIME ZONE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_update_upload_logs_created_at
  ON employee_update_upload_logs(created_at DESC);
`;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `employee_upload_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function normalizeLog(log: EmployeeUpdateUploadLog): EmployeeUpdateUploadLog {
  return {
    id: log.id || randomId(),
    file_name: String(log.file_name || ""),
    upload_type: String(log.upload_type || "emergency_upload_update"),
    matched_profiles: Number(log.matched_profiles || 0),
    updated_profiles: Number(log.updated_profiles || 0),
    inactive_profiles: Number(log.inactive_profiles || 0),
    unchanged_profiles: Number(log.unchanged_profiles || 0),
    unmatched_rows: Number(log.unmatched_rows || 0),
    remote_message: String(log.remote_message || ""),
    items: Array.isArray(log.items) ? log.items : [],
    rollback_employees: Array.isArray(log.rollback_employees) ? log.rollback_employees : [],
    rolled_back_at: log.rolled_back_at ? String(log.rolled_back_at) : "",
    created_at: log.created_at || new Date().toISOString(),
  };
}

function mergeLogMessages(...messages: Array<string | undefined>) {
  return Array.from(new Set(messages.map((message) => String(message || "").trim()).filter(Boolean))).join(" ");
}

function mergeLogsById(...collections: EmployeeUpdateUploadLog[][]) {
  const merged = collections.flat().reduce<Map<string, EmployeeUpdateUploadLog>>((map, item) => {
      const normalized = normalizeLog(item);
      const existing = map.get(normalized.id);

      if (!existing) {
        map.set(normalized.id, normalized);
        return map;
      }

      const existingItems = Array.isArray(existing.items) ? existing.items : [];
      const existingRollbackEmployees = Array.isArray(existing.rollback_employees) ? existing.rollback_employees : [];
      const normalizedRollbackEmployees = Array.isArray(normalized.rollback_employees) ? normalized.rollback_employees : [];

      map.set(
        normalized.id,
        normalizeLog({
          ...existing,
          ...normalized,
          file_name: normalized.file_name || existing.file_name,
          upload_type: normalized.upload_type || existing.upload_type,
          matched_profiles: Math.max(existing.matched_profiles, normalized.matched_profiles),
          updated_profiles: Math.max(existing.updated_profiles, normalized.updated_profiles),
          inactive_profiles: Math.max(existing.inactive_profiles, normalized.inactive_profiles),
          unchanged_profiles: Math.max(existing.unchanged_profiles, normalized.unchanged_profiles),
          unmatched_rows: Math.max(existing.unmatched_rows, normalized.unmatched_rows),
          remote_message: mergeLogMessages(existing.remote_message, normalized.remote_message),
          items: normalized.items.length >= existingItems.length ? normalized.items : existingItems,
          rollback_employees:
            normalizedRollbackEmployees.length >= existingRollbackEmployees.length
              ? normalizedRollbackEmployees
              : existingRollbackEmployees,
          rolled_back_at:
            [existing.rolled_back_at, normalized.rolled_back_at].filter(Boolean).sort().at(-1) || "",
          created_at: existing.created_at || normalized.created_at,
        })
      );

      return map;
    }, new Map<string, EmployeeUpdateUploadLog>());

  return Array.from(merged.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function loadLocalLogs(): EmployeeUpdateUploadLog[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(EMPLOYEE_UPDATE_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EmployeeUpdateUploadLog[];
    return Array.isArray(parsed) ? parsed.map(normalizeLog).sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  } catch (error) {
    console.error("Load employee update logs error:", error);
    return [];
  }
}

function saveLocalLogs(logs: EmployeeUpdateUploadLog[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(EMPLOYEE_UPDATE_LOG_STORAGE_KEY, JSON.stringify(logs.map(normalizeLog)));
  } catch (error) {
    console.error("Save employee update logs error:", error);
  }
}

function openEmployeeUpdateLogDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(EMPLOYEE_UPDATE_LOG_DB_NAME, EMPLOYEE_UPDATE_LOG_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EMPLOYEE_UPDATE_LOG_DB_STORE)) {
        const store = database.createObjectStore(EMPLOYEE_UPDATE_LOG_DB_STORE, { keyPath: "id" });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error("Open employee update log IndexedDB error:", request.error);
      resolve(null);
    };
  });
}

async function readIndexedDbLogs(): Promise<EmployeeUpdateUploadLog[]> {
  const database = await openEmployeeUpdateLogDb();
  if (!database) return [];

  return new Promise((resolve) => {
    const transaction = database.transaction(EMPLOYEE_UPDATE_LOG_DB_STORE, "readonly");
    const store = transaction.objectStore(EMPLOYEE_UPDATE_LOG_DB_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const result = Array.isArray(request.result) ? request.result.map((log) => normalizeLog(log as EmployeeUpdateUploadLog)) : [];
      resolve(result.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    };
    request.onerror = () => {
      console.error("Read employee update log IndexedDB error:", request.error);
      resolve([]);
    };
  });
}

async function writeIndexedDbLogs(logs: EmployeeUpdateUploadLog[]) {
  const database = await openEmployeeUpdateLogDb();
  if (!database) return false;

  return new Promise<boolean>((resolve) => {
    const transaction = database.transaction(EMPLOYEE_UPDATE_LOG_DB_STORE, "readwrite");
    const store = transaction.objectStore(EMPLOYEE_UPDATE_LOG_DB_STORE);
    const normalized = logs.map(normalizeLog);

    store.clear();
    normalized.forEach((log) => store.put(log));

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => {
      console.error("Write employee update log IndexedDB error:", transaction.error);
      resolve(false);
    };
  });
}

async function loadStoredLogs(): Promise<EmployeeUpdateUploadLog[]> {
  const indexedDbLogs = await readIndexedDbLogs();
  const localLogs = loadLocalLogs();
  const merged = mergeLogsById(indexedDbLogs, localLogs);

  if (merged.length > 0) {
    const saved = await writeIndexedDbLogs(merged);
    if (saved) saveLocalLogs([]);
  }

  return merged;
}

async function saveStoredLogs(logs: EmployeeUpdateUploadLog[]) {
  const normalized = logs.map(normalizeLog).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const saved = await writeIndexedDbLogs(normalized);
  if (!saved) {
    saveLocalLogs(normalized);
  } else {
    saveLocalLogs([]);
  }
}

function getErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "");

  if (message.includes("Could not find the table 'public.employee_update_upload_logs'")) {
    return "Remote upload log table is not set up yet. Upload logs are still being stored locally in this browser.";
  }
  if (message.includes('relation "public.employee_update_upload_logs" does not exist') || message.includes('relation "employee_update_upload_logs" does not exist')) {
    return "Remote upload log table does not exist yet. Upload logs are still being stored locally in this browser.";
  }
  return message;
}

export async function getEmployeeUpdateUploadLogs(): Promise<EmployeeUpdateUploadLog[]> {
  const localLogs = await loadStoredLogs();

  try {
    const { data, error } = await supabase
      .from("employee_update_upload_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Get employee update logs warning:", getErrorMessage(error));
      return localLogs;
    }

    const remoteLogs = (data || []).map((record) =>
      normalizeLog({
        id: String(record.id),
        file_name: String(record.file_name || ""),
        upload_type: String(record.upload_type || "emergency_upload_update"),
        matched_profiles: Number(record.matched_profiles || 0),
        updated_profiles: Number(record.updated_profiles || 0),
        inactive_profiles: Number(record.inactive_profiles || 0),
        unchanged_profiles: Number(record.unchanged_profiles || 0),
        unmatched_rows: Number(record.unmatched_rows || 0),
        remote_message: String(record.remote_message || ""),
        items: Array.isArray(record.payload?.items) ? record.payload.items : [],
        rollback_employees: Array.isArray(record.payload?.rollback_employees) ? record.payload.rollback_employees : [],
        rolled_back_at: String(record.rolled_back_at || ""),
        created_at: String(record.created_at || new Date().toISOString()),
      })
    );

    const merged = mergeLogsById(remoteLogs, localLogs);

    await saveStoredLogs(merged);
    return merged;
  } catch (error) {
    console.warn("Get employee update logs warning:", getErrorMessage(error));
    return localLogs;
  }
}

export async function saveEmployeeUpdateUploadLog(log: Omit<EmployeeUpdateUploadLog, "id" | "created_at">) {
  const entry = normalizeLog({
    ...log,
    id: randomId(),
    created_at: new Date().toISOString(),
  });

  const localLogs = [entry, ...(await loadStoredLogs())];
  await saveStoredLogs(localLogs);

  try {
    const { error } = await supabase.from("employee_update_upload_logs").insert({
      id: entry.id,
      file_name: entry.file_name,
      upload_type: entry.upload_type || "emergency_upload_update",
      matched_profiles: entry.matched_profiles,
      updated_profiles: entry.updated_profiles,
      inactive_profiles: entry.inactive_profiles,
      unchanged_profiles: entry.unchanged_profiles,
      unmatched_rows: entry.unmatched_rows,
      remote_message: entry.remote_message || "",
      rolled_back_at: entry.rolled_back_at || null,
      payload: { items: entry.items, rollback_employees: entry.rollback_employees || [] },
      created_at: entry.created_at,
    });

    if (error) {
      const message = getErrorMessage(error);
      console.warn("Save employee update log warning:", message);
      return { success: true, error: message, entry };
    }

    return { success: true, entry };
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn("Save employee update log warning:", message);
    return { success: true, error: message, entry };
  }
}

export async function markEmployeeUpdateUploadLogRolledBack(logId: string, rolledBackAt: string) {
  const localLogs = (await loadStoredLogs()).map((log) => (log.id === logId ? normalizeLog({ ...log, rolled_back_at: rolledBackAt }) : log));
  await saveStoredLogs(localLogs);

  try {
    const { error } = await supabase
      .from("employee_update_upload_logs")
      .update({ rolled_back_at: rolledBackAt })
      .eq("id", logId);

    if (error) {
      const message = getErrorMessage(error);
      console.warn("Update employee upload rollback warning:", message);
      return { success: true, error: message };
    }

    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn("Update employee upload rollback warning:", message);
    return { success: true, error: message };
  }
}

export async function clearEmployeeUpdateUploadLogs() {
  await saveStoredLogs([]);

  try {
    const { error } = await supabase
      .from("employee_update_upload_logs")
      .delete()
      .neq("id", "");

    if (error) {
      const message = getErrorMessage(error);
      console.warn("Clear employee update logs warning:", message);
      return { success: true, error: message };
    }

    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn("Clear employee update logs warning:", message);
    return { success: true, error: message };
  }
}
