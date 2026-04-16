// iPulse Systems API Integration Service

import { supabase } from '@/lib/supabase'

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

async function loadConfigFromDb(): Promise<IpulseConfig | null> {
  try {
    const { data, error } = await supabase
      .from('ipulse_config')
      .select('*')
      .limit(1)
    
    if (error || !data || data.length === 0) return null
    return data[0] as IpulseConfig
  } catch {
    return null
  }
}

export async function getConfig(): Promise<IpulseConfig | null> {
  return loadConfigFromDb()
}

export async function saveConfig(config: Partial<IpulseConfig>): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await loadConfigFromDb()
    const now = new Date().toISOString()
    
    if (existing) {
      const { error } = await supabase
        .from('ipulse_config')
        .update({
          ...config,
          updated_at: now
        })
        .eq('id', existing.id)
      
      if (error) return { success: false, error: error.message }
    } else {
      const { error } = await supabase
        .from('ipulse_config')
        .insert({
          ...config,
          created_at: now,
          updated_at: now
        })
      
      if (error) return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function testConnection(config: {
  api_url: string
  api_key: string
  api_secret: string
}): Promise<{ success: boolean; error?: string; response_time?: number }> {
  try {
    const start = Date.now()
    const response = await fetch(`${config.api_url}/api/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      }
    })
    const responseTime = Date.now() - start
    
    if (response.ok) {
      return { success: true, response_time: responseTime }
    }
    
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Unauthorized - check your API key and secret' }
    }
    
    const errorText = await response.text()
    return { success: false, error: errorText || `HTTP ${response.status}` }
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      return { success: false, error: 'Cannot connect to API - check URL' }
    }
    return { success: false, error: String(err) }
  }
}

export async function getSyncLogs(limit = 50): Promise<SyncLog[]> {
  try {
    const { data, error } = await supabase
      .from('ipulse_sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit)
    
    if (error) return []
    return (data || []) as SyncLog[]
  } catch {
    return []
  }
}

export async function addSyncLog(log: Omit<SyncLog, 'id'>): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('ipulse_sync_logs')
      .insert(log)
      .select('id')
    
    if (error) return null
    return data?.[0]?.id || null
  } catch {
    return null
  }
}

export async function updateSyncLog(id: string, updates: Partial<SyncLog>): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ipulse_sync_logs')
      .update(updates)
      .eq('id', id)
    
    return !error
  } catch {
    return false
  }
}

export async function clearSyncLogs(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ipulse_sync_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    return !error
  } catch {
    return false
  }
}

export async function syncFromIpulse(syncType: SyncLog['sync_type'] = 'manual'): Promise<{
  success: boolean
  employees_synced: number
  attendance_synced: number
  errors: string[]
  duration_seconds: number
}> {
  const startTime = Date.now()
  const errors: string[] = []
  let employees_synced = 0
  let attendance_synced = 0
  
  const logId = await addSyncLog({
    sync_type: syncType,
    status: 'started',
    employees_synced: 0,
    attendance_synced: 0,
    errors: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    duration_seconds: null
  })
  
  try {
    const config = await loadConfigFromDb()
    if (!config?.api_url || !config?.api_key) {
      errors.push('iPulse not configured')
      await updateSyncLog(logId!, {
        status: 'error',
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: (Date.now() - startTime) / 1000
      })
      return { success: false, employees_synced: 0, attendance_synced: 0, errors, duration_seconds: 0 }
    }
    
    // Sync employees
    const employeesResponse = await fetch(`${config.api_url}/api/employees`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'X-API-Secret': config.api_secret || '',
        'Content-Type': 'application/json'
      }
    })
    
    if (!employeesResponse.ok) {
      if (employeesResponse.status === 401 || employeesResponse.status === 403) {
        errors.push('Unauthorized - check your API key and secret')
      } else {
        const errText = await employeesResponse.text()
        errors.push(`Employees API error: ${errText}`)
      }
    } else {
      const employees = await employeesResponse.json() as IpulseEmployee[]
      
      if (employees.length > 0) {
        const processed = employees.map(emp => ({
          employee_code: emp.employee_code,
          first_name: emp.first_name,
          last_name: emp.last_name,
          title: emp.title || '',
          alias: emp.alias || '',
          id_number: emp.id_number || '',
          email: emp.email || '',
          phone: emp.phone || '',
          job_title: emp.job_title || '',
          department: emp.department || '',
          region: emp.region || '',
          store: emp.store || '',
          store_code: emp.store_code || '',
          hire_date: emp.hire_date || '',
          person_type: emp.person_type || '',
          company: emp.company || '',
          branch: emp.branch || '',
          business_unit: emp.business_unit || '',
          cost_center: emp.cost_center || '',
          team: emp.team || '',
          ta_integration_id_1: emp.ta_integration_id_1 || '',
          ta_integration_id_2: emp.ta_integration_id_2 || '',
          access_profile: emp.access_profile || '',
          ta_enabled: emp.ta_enabled ?? null,
          permanent: emp.permanent ?? null,
          active: emp.active ?? true,
          status: emp.status || 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }))
        
        const { error } = await supabase
          .from('employees')
          .upsert(processed, { onConflict: 'employee_code' })
          .select()
        
        if (error) {
          errors.push(`Employee upsert error: ${error.message}`)
        } else {
          employees_synced = processed.length
        }
      }
    }
    
    // Sync attendance
    const today = new Date().toISOString().split('T')[0]
    const attendanceResponse = await fetch(`${config.api_url}/api/attendance?date=${today}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'X-API-Secret': config.api_secret || '',
        'Content-Type': 'application/json'
      }
    })
    
    if (!attendanceResponse.ok) {
      if (attendanceResponse.status === 401 || attendanceResponse.status === 403) {
        errors.push('Unauthorized for attendance - check your API key and secret')
      } else {
        const errText = await attendanceResponse.text()
        errors.push(`Attendance API error: ${errText}`)
      }
    } else {
      const attendance = await attendanceResponse.json() as IpulseAttendanceRecord[]
      
      if (attendance.length > 0) {
        const processed = attendance.map(rec => ({
          employee_code: rec.employee_code,
          name: rec.employee_code,
          region: rec.region || '',
          region_code: '',
          store: rec.store || '',
          store_code: rec.store || '',
          scheduled: rec.scheduled,
          at_work: rec.at_work,
          leave: rec.leave,
          day_off: rec.day_off,
          problem: rec.problem,
          upload_date: rec.date,
          created_at: new Date().toISOString()
        }))
        
        const { error } = await supabase
          .from('attendance_records')
          .upsert(processed, { onConflict: 'employee_code,upload_date,store_code' })
          .select()
        
        if (error) {
          errors.push(`Attendance upsert error: ${error.message}`)
        } else {
          attendance_synced = processed.length
        }
      }
    }
    
    const duration_seconds = (Date.now() - startTime) / 1000
    
    await updateSyncLog(logId!, {
      status: errors.length > 0 ? 'partial' : 'success',
      employees_synced,
      attendance_synced,
      errors,
      completed_at: new Date().toISOString(),
      duration_seconds
    })
    
    await saveConfig({
      last_sync_at: new Date().toISOString(),
      last_sync_status: errors.length > 0 ? 'partial' : 'success',
      last_error: errors.length > 0 ? errors.join('; ') : null
    })
    
    return {
      success: errors.length === 0,
      employees_synced,
      attendance_synced,
      errors,
      duration_seconds
    }
  } catch (err) {
    const errorMsg = String(err)
    errors.push(errorMsg)
    
    await updateSyncLog(logId!, {
      status: 'error',
      employees_synced,
      attendance_synced,
      errors,
      completed_at: new Date().toISOString(),
      duration_seconds: (Date.now() - startTime) / 1000
    })
    
    return {
      success: false,
      employees_synced,
      attendance_synced,
      errors,
      duration_seconds: (Date.now() - startTime) / 1000
    }
  }
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null

export function startAutoSync(intervalMinutes: number, onSync: () => Promise<void>): void {
  stopAutoSync()
  
  const intervalMs = intervalMinutes * 60 * 1000
  syncIntervalId = setInterval(() => {
    onSync()
  }, intervalMs)
}

export function stopAutoSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId)
    syncIntervalId = null
  }
}

export const IPULSE_SETUP_SQL = `
-- Secure iPulse setup

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

GRANT ALL ON TABLE ipulse_config TO anon, authenticated;
GRANT ALL ON TABLE ipulse_sync_logs TO anon, authenticated;
`
