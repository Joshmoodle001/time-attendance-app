import { CALENDAR_STORAGE_KEY } from "@/services/calendar";

const TRIAL_RESET_VERSION_KEY = "trial-reset-version-v1";
const TRIAL_RESET_TARGET_VERSION = "2026-04-04-trial-reset-v1";

const LOCAL_STORAGE_KEYS_TO_CLEAR = [
  "attendance-records-cache-v1",
  "employee-profiles-cache-v1",
  "employee-update-upload-logs-v1",
  "leave-upload-batches-cache-v1",
  "leave-applications-cache-v1",
  "shift-rosters-cache-v1",
  "shift-sync-settings-v2",
  "shift-sync-sections-v1",
  "report-templates-v1",
  "communication-profiles-v1",
  "communication-automations-v1",
  "last-attendance-date-v1",
  "biometric-clock-events-cache-v1",
].filter((key) => key !== CALENDAR_STORAGE_KEY);

const INDEXED_DB_NAMES_TO_CLEAR = [
  "time-attendance-employee-db",
  "time-attendance-clock-db",
  "time-attendance-employee-update-log-db",
  "time-attendance-emergency-employee-overrides-db",
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

  try {
    window.localStorage.setItem(TRIAL_RESET_VERSION_KEY, TRIAL_RESET_TARGET_VERSION);
  } catch {
    // Ignore storage write failures.
  }

  return { ran: true };
}
