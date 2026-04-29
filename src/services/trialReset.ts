import { CALENDAR_STORAGE_KEY } from "@/services/calendar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { importEmployeesRemoteOverwrite } from "@/services/database";
import { EMPLOYEE_PAYROLL_SEED } from "@/data/employeePayrollSeed";

const TRIAL_RESET_VERSION_KEY = "trial-reset-version-v1";
const TRIAL_RESET_TARGET_VERSION = "2026-04-29-team-reset-v1";

const LOCAL_STORAGE_KEYS_TO_CLEAR = [
  "attendance-records-cache-v1",
  "employee-profiles-cache-v1",
  "employee-status-history-cache-v1",
  "employee-update-upload-logs-v1",
  "leave-upload-batches-cache-v1",
  "leave-applications-cache-v1",
  "shift-rosters-cache-v1",
  "shift-roster-history-cache-v1",
  "shift-roster-change-events-cache-v1",
  "shift-sync-settings-v2",
  "shift-sync-sections-v1",
  "report-templates-v1",
  "communication-profiles-v1",
  "communication-automations-v1",
  "last-attendance-date-v1",
  "biometric-clock-events-cache-v1",
  "coversheet-data-v1",
  "pfm-store-assignments-v1",
  "payroll-settings-v1",
  "ipulse-config-v1",
  "ipulse-sync-logs-v1",
].filter((key) => key !== CALENDAR_STORAGE_KEY);

const INDEXED_DB_NAMES_TO_CLEAR = [
  "time-attendance-employee-db",
  "time-attendance-clock-db",
  "time-attendance-employee-update-log-db",
  "time-attendance-emergency-employee-overrides-db",
  "time-attendance-coversheet-db",
];

const REMOTE_TABLES_TO_CLEAR: Array<{ table: string; column: string }> = [
  { table: "attendance_records", column: "id" },
  { table: "attendance_upload_sessions", column: "id" },
  { table: "employee_status_history", column: "id" },
  { table: "employees", column: "employee_code" },
  { table: "biometric_clock_events", column: "id" },
  { table: "employee_update_upload_logs", column: "id" },
  { table: "leave_applications", column: "id" },
  { table: "leave_upload_batches", column: "id" },
  { table: "shift_rosters", column: "id" },
  { table: "shift_roster_history", column: "id" },
  { table: "shift_roster_change_events", column: "id" },
  { table: "store_assignments", column: "username" },
  { table: "ipulse_sync_logs", column: "id" },
  { table: "ipulse_config", column: "id" },
];

function deleteIndexedDb(name: string) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    try {
      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function performOneTimeTrialReset() {
  if (typeof window === "undefined") {
    return { ran: false };
  }

  const alreadyApplied = window.localStorage.getItem(TRIAL_RESET_VERSION_KEY);
  if (alreadyApplied === TRIAL_RESET_TARGET_VERSION) {
    return { ran: false };
  }

  LOCAL_STORAGE_KEYS_TO_CLEAR.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures so reset can continue.
    }
  });

  await Promise.all(INDEXED_DB_NAMES_TO_CLEAR.map((name) => deleteIndexedDb(name)));

  const errors: string[] = [];

  if (isSupabaseConfigured) {
    for (const target of REMOTE_TABLES_TO_CLEAR) {
      try {
        const { error } = await supabase.from(target.table).delete().not(target.column, "is", null);
        if (error) {
          errors.push(`${target.table}: ${error.message}`);
        }
      } catch (error) {
        errors.push(`${target.table}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  const importResult = await importEmployeesRemoteOverwrite(EMPLOYEE_PAYROLL_SEED);
  if (!importResult.success) {
    errors.push(importResult.error || "Employee seed import failed.");
  }

  try {
    window.localStorage.setItem(TRIAL_RESET_VERSION_KEY, TRIAL_RESET_TARGET_VERSION);
  } catch {
    // Ignore storage write failures.
  }

  return { ran: true, importedEmployees: importResult.count || EMPLOYEE_PAYROLL_SEED.length, error: errors.join(" | ") || undefined };
}
