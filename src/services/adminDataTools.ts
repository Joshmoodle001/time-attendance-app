export type AppRestoreBundle = {
  version: "2026-04-29-admin-backup-v1"
  createdAt: string
  source: "time-attendance-app"
  remote: Record<string, unknown[]>
  local: Record<string, unknown>
  summary: Record<string, number>
}

export const APP_RESTORE_BUNDLE_VERSION = "2026-04-29-admin-backup-v1"

const EMPLOYEE_SOURCE_MODE_STORAGE_KEY = "employee-source-mode-v1"
const CALENDAR_STORAGE_KEY = "calendar-builder-events-v1"
const AUTH_STORAGE_KEY = "pfm-auth-state-v2"
const DEVICE_STORAGE_KEYS = ["device-records-v1", "device-import-date-v1"]
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
]

const INDEXED_DB_NAMES_TO_CLEAR = [
  "time-attendance-employee-db",
  "time-attendance-clock-db",
  "time-attendance-employee-update-log-db",
  "time-attendance-emergency-employee-overrides-db",
  "time-attendance-coversheet-db",
]

function preserveKey(key: string) {
  return key === CALENDAR_STORAGE_KEY || key === AUTH_STORAGE_KEY || DEVICE_STORAGE_KEYS.includes(key)
}

function deleteIndexedDb(name: string) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    try {
      const request = window.indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function clearLocalOperationalData() {
  if (typeof window === "undefined") return

  for (const key of LOCAL_STORAGE_KEYS_TO_CLEAR) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }

  try {
    window.localStorage.setItem(EMPLOYEE_SOURCE_MODE_STORAGE_KEY, "local")
  } catch {
    // ignore
  }

  const allKeys = Object.keys(window.localStorage)
  for (const key of allKeys) {
    if (preserveKey(key) || key === EMPLOYEE_SOURCE_MODE_STORAGE_KEY) continue
    if (!LOCAL_STORAGE_KEYS_TO_CLEAR.includes(key)) continue
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }

  await Promise.all(INDEXED_DB_NAMES_TO_CLEAR.map((name) => deleteIndexedDb(name)))
}

export async function createAppRestoreBundle(): Promise<AppRestoreBundle> {
  throw new Error("Restore export is not enabled in this admin workflow.")
}

export async function resetApplicationData(onProgress?: (step: string, percent: number) => void) {
  onProgress?.("Clearing Supabase operational data...", 20)

  const response = await fetch("/api/admin-reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope: "operational" }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success !== true) {
    const message = payload?.message || payload?.error || `Reset failed with status ${response.status}`
    return { success: false, errors: [message] }
  }

  onProgress?.("Clearing browser operational data...", 70)
  await clearLocalOperationalData()

  onProgress?.("Finalizing reset...", 100)
  return { success: true, errors: [] as string[], remote: payload }
}

export async function restoreApplicationData(_bundle: AppRestoreBundle) {
  throw new Error("Restore is not enabled in this admin workflow.")
}
