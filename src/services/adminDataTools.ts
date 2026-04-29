const ADMIN_DATA_TOOLS_DISABLED_MESSAGE =
  "Browser-side backup, reset, and restore are temporarily disabled. Keep employee updates inside the payroll workbook import flow."

export type AppRestoreBundle = {
  version: "2026-04-29-admin-backup-v1"
  createdAt: string
  source: "time-attendance-app"
  remote: Record<string, unknown[]>
  local: Record<string, unknown>
  summary: Record<string, number>
}

export const APP_RESTORE_BUNDLE_VERSION = "2026-04-29-admin-backup-v1"

export async function createAppRestoreBundle(): Promise<AppRestoreBundle> {
  throw new Error(ADMIN_DATA_TOOLS_DISABLED_MESSAGE)
}

export async function resetApplicationData(onProgress?: (step: string, percent: number) => void) {
  onProgress?.(ADMIN_DATA_TOOLS_DISABLED_MESSAGE, 100)
  return { success: false, errors: [ADMIN_DATA_TOOLS_DISABLED_MESSAGE] }
}

export async function restoreApplicationData(_bundle: AppRestoreBundle) {
  throw new Error(ADMIN_DATA_TOOLS_DISABLED_MESSAGE)
}
