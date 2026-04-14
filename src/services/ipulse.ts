// iPulse Systems API Integration Service
// Browser-side configuration and sync are intentionally disabled.
// Move all iPulse secrets and sync logic to a server-side function before re-enabling.

export interface IpulseConfig {
  id: string
  api_url: string
  api_key: string
  api_secret: string
  sync_interval_minutes: number
  auto_sync_enabled: boolean
  last_sync_at: string | null
  last_sync_status: 'success' | 'error' | 'partial' | 'pending' | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface SyncLog {
  id: string
  sync_type: 'full' | 'incremental' | 'manual'
  status: 'started' | 'success' | 'error' | 'partial'
  employees_synced: number
  attendance_synced: number
  errors: string[]
  started_at: string
  completed_at: string | null
  duration_seconds: number | null
}

export interface IpulseEmployee {
  employee_code: string
  first_name: string
  last_name: string
  title?: string
  alias?: string
  id_number?: string
  email?: string
  phone?: string
  job_title?: string
  department?: string
  region?: string
  store?: string
  store_code?: string
  hire_date?: string
  person_type?: string
  fingerprints_enrolled?: number | null
  company?: string
  branch?: string
  business_unit?: string
  cost_center?: string
  team?: string
  ta_integration_id_1?: string
  ta_integration_id_2?: string
  access_profile?: string
  ta_enabled?: boolean | null
  permanent?: boolean | null
  active?: boolean | null
  status: 'active' | 'inactive' | 'terminated'
}

export interface IpulseAttendanceRecord {
  employee_code: string
  date: string
  scheduled: boolean
  at_work: boolean
  leave: boolean
  day_off: boolean
  problem: boolean
  clock_in?: string
  clock_out?: string
  region?: string
  store?: string
}

const IPULSE_CLIENT_DISABLED_MESSAGE =
  'iPulse browser-side configuration and sync are temporarily disabled. Move this workflow to a server-side function before re-enabling it.'

export async function getConfig(): Promise<IpulseConfig | null> {
  return null
}

export async function saveConfig(_config: Partial<IpulseConfig>): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: IPULSE_CLIENT_DISABLED_MESSAGE }
}

export async function testConnection(_config: {
  api_url: string
  api_key: string
  api_secret: string
}): Promise<{ success: boolean; error?: string; response_time?: number }> {
  return { success: false, error: IPULSE_CLIENT_DISABLED_MESSAGE }
}

export async function getSyncLogs(_limit = 50): Promise<SyncLog[]> {
  return []
}

export async function addSyncLog(_log: Omit<SyncLog, 'id'>): Promise<string | null> {
  return null
}

export async function updateSyncLog(_id: string, _updates: Partial<SyncLog>): Promise<boolean> {
  return false
}

export async function clearSyncLogs(): Promise<boolean> {
  return false
}

export async function syncFromIpulse(_syncType: SyncLog['sync_type'] = 'manual'): Promise<{
  success: boolean
  employees_synced: number
  attendance_synced: number
  errors: string[]
  duration_seconds: number
}> {
  return {
    success: false,
    employees_synced: 0,
    attendance_synced: 0,
    errors: [IPULSE_CLIENT_DISABLED_MESSAGE],
    duration_seconds: 0,
  }
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null

export function startAutoSync(_intervalMinutes: number, _onSync: () => Promise<void>): void {
  stopAutoSync()
}

export function stopAutoSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId)
    syncIntervalId = null
  }
}

export const IPULSE_SETUP_SQL = `
-- Secure iPulse setup
-- Keep iPulse secrets out of the browser. Store them only in server-side environment variables.

CREATE TABLE IF NOT EXISTS ipulse_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  api_secret TEXT NOT NULL DEFAULT '',
  sync_interval_minutes INTEGER DEFAULT 60,
  auto_sync_enabled BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'error', 'partial', 'pending')),
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ipulse_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'error', 'partial')),
  employees_synced INTEGER DEFAULT 0,
  attendance_synced INTEGER DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds NUMERIC(10,2)
);

ALTER TABLE ipulse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipulse_sync_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY['ipulse_config', 'ipulse_sync_logs'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON TABLE public.ipulse_config, public.ipulse_sync_logs FROM anon, authenticated;
`
