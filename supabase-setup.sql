-- =====================================================
-- ATTENDANCE DATABASE SETUP FOR SUPABASE (SECURE BASELINE)
-- Run this in: Supabase Dashboard > SQL Editor
-- =====================================================

-- Create attendance_records table
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  region_code TEXT,
  store TEXT NOT NULL,
  store_code TEXT,
  scheduled BOOLEAN DEFAULT false,
  at_work BOOLEAN DEFAULT false,
  leave BOOLEAN DEFAULT false,
  day_off BOOLEAN DEFAULT false,
  problem BOOLEAN DEFAULT false,
  clock_count INTEGER DEFAULT 0,
  first_clock TEXT,
  last_clock TEXT,
  status_label TEXT,
  clockings JSONB DEFAULT '[]'::jsonb,
  upload_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS clock_count INTEGER DEFAULT 0;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS first_clock TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_clock TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS status_label TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS clockings JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_attendance_upload_date ON attendance_records(upload_date);
CREATE INDEX IF NOT EXISTS idx_attendance_region ON attendance_records(region);
CREATE INDEX IF NOT EXISTS idx_attendance_store ON attendance_records(store);
CREATE INDEX IF NOT EXISTS idx_attendance_region_store ON attendance_records(region, store);

CREATE TABLE IF NOT EXISTS attendance_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_date DATE NOT NULL UNIQUE,
  file_name TEXT,
  record_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_upload_sessions(upload_date DESC);

CREATE TABLE IF NOT EXISTS shift_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  store_code TEXT,
  source_file_name TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_rosters_updated_at ON shift_rosters(updated_at DESC);

CREATE TABLE IF NOT EXISTS shift_roster_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key TEXT NOT NULL UNIQUE,
  sheet_name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  store_code TEXT,
  source_file_name TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shift_roster_history_sheet_name ON shift_roster_history(sheet_name);
CREATE INDEX IF NOT EXISTS idx_shift_roster_history_effective_from ON shift_roster_history(effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_shift_roster_history_changed_at ON shift_roster_history(changed_at DESC);

CREATE TABLE IF NOT EXISTS shift_roster_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  employee_code TEXT DEFAULT '',
  employee_name TEXT DEFAULT '',
  week_label TEXT DEFAULT '',
  field TEXT NOT NULL,
  before_value TEXT DEFAULT '',
  after_value TEXT DEFAULT '',
  change_type TEXT NOT NULL CHECK (change_type IN ('added', 'updated', 'removed')),
  effective_from DATE NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_file_name TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  store_code TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_shift_roster_change_events_employee_code ON shift_roster_change_events(employee_code);
CREATE INDEX IF NOT EXISTS idx_shift_roster_change_events_effective_from ON shift_roster_change_events(effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_shift_roster_change_events_changed_at ON shift_roster_change_events(changed_at DESC);

CREATE TABLE IF NOT EXISTS shift_sync_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  last_universal_synced_at TIMESTAMPTZ,
  last_universal_status TEXT DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_sync_settings_updated_at ON shift_sync_settings(updated_at DESC);

CREATE TABLE IF NOT EXISTS biometric_clock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  employee_code TEXT NOT NULL,
  employee_number TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  device_name TEXT DEFAULT '',
  clockiq_device_name TEXT DEFAULT '',
  direction TEXT DEFAULT '',
  method TEXT DEFAULT '',
  company TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  person_type TEXT DEFAULT '',
  business_unit TEXT DEFAULT '',
  department TEXT DEFAULT '',
  team TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  cost_center TEXT DEFAULT '',
  custom_1 TEXT DEFAULT '',
  custom_2 TEXT DEFAULT '',
  access_granted BOOLEAN,
  access_verified BOOLEAN,
  region TEXT DEFAULT '',
  store TEXT DEFAULT '',
  store_code TEXT DEFAULT '',
  clocked_at TIMESTAMPTZ NOT NULL,
  clock_date DATE NOT NULL,
  clock_time TEXT DEFAULT '',
  source_file_name TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_employee_code ON biometric_clock_events(employee_code);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clock_date ON biometric_clock_events(clock_date DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clocked_at ON biometric_clock_events(clocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_id_number ON biometric_clock_events(id_number);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_store ON biometric_clock_events(store);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT DEFAULT '',
  title TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  department TEXT DEFAULT '',
  region TEXT DEFAULT '',
  store TEXT DEFAULT '',
  store_code TEXT DEFAULT '',
  hire_date DATE,
  person_type TEXT DEFAULT '',
  fingerprints_enrolled INTEGER,
  company TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  business_unit TEXT DEFAULT '',
  cost_center TEXT DEFAULT '',
  team TEXT DEFAULT '',
  ta_integration_id_1 TEXT DEFAULT '',
  ta_integration_id_2 TEXT DEFAULT '',
  access_profile TEXT DEFAULT '',
  ta_enabled BOOLEAN,
  permanent BOOLEAN,
  active BOOLEAN DEFAULT true,
  termination_reason TEXT DEFAULT '',
  termination_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS alias TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS person_type TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS fingerprints_enrolled INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS business_unit TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_center TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_integration_id_1 TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_integration_id_2 TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS access_profile TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_enabled BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;

CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_employees_id_number ON employees(id_number);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

CREATE TABLE IF NOT EXISTS employee_status_history (
  id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL,
  before_status TEXT,
  after_status TEXT NOT NULL CHECK (after_status IN ('active', 'inactive', 'terminated')),
  before_active BOOLEAN,
  after_active BOOLEAN,
  effective_from DATE NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  termination_date DATE,
  termination_reason TEXT DEFAULT '',
  store TEXT DEFAULT '',
  store_code TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_employee_status_history_employee_code ON employee_status_history(employee_code);
CREATE INDEX IF NOT EXISTS idx_employee_status_history_effective_from ON employee_status_history(effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_employee_status_history_changed_at ON employee_status_history(changed_at DESC);

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

CREATE TABLE IF NOT EXISTS leave_upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  applied_rows INTEGER DEFAULT 0,
  unmatched_rows INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id UUID REFERENCES leave_upload_batches(id) ON DELETE CASCADE,
  row_number INTEGER DEFAULT 0,
  representative_name TEXT DEFAULT '',
  submitted_at TEXT DEFAULT '',
  place TEXT DEFAULT '',
  territory TEXT DEFAULT '',
  raw_employee_code TEXT DEFAULT '',
  raw_id_number TEXT DEFAULT '',
  merchandiser_name TEXT DEFAULT '',
  merchandiser_surname TEXT DEFAULT '',
  leave_type TEXT DEFAULT '',
  leave_days NUMERIC DEFAULT 0,
  leave_start_date DATE NOT NULL,
  leave_end_date DATE NOT NULL,
  form_link TEXT DEFAULT '',
  comments TEXT DEFAULT '',
  matched_employee_id TEXT DEFAULT '',
  matched_employee_code TEXT DEFAULT '',
  matched_by TEXT DEFAULT '',
  matched_roster_sheet_name TEXT DEFAULT '',
  matched_roster_store_name TEXT DEFAULT '',
  matched_roster_store_code TEXT DEFAULT '',
  apply_status TEXT DEFAULT 'unmatched',
  status_reason TEXT DEFAULT '',
  source_file_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_upload_batches_created_at ON leave_upload_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_applications_upload_batch_id ON leave_applications(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee_code ON leave_applications(matched_employee_code);
CREATE INDEX IF NOT EXISTS idx_leave_applications_start_date ON leave_applications(leave_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_applications_end_date ON leave_applications(leave_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_applications_status ON leave_applications(apply_status);

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

ALTER TABLE ipulse_config DROP CONSTRAINT IF EXISTS ipulse_config_last_sync_status_check;
ALTER TABLE ipulse_config
  ADD CONSTRAINT ipulse_config_last_sync_status_check
  CHECK (last_sync_status IN ('success', 'error', 'partial', 'pending'));

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

CREATE INDEX IF NOT EXISTS idx_ipulse_sync_logs_started ON ipulse_sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipulse_sync_logs_status ON ipulse_sync_logs(status);

-- =====================================================
-- SECURITY BASELINE
-- =====================================================

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_roster_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_roster_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_update_upload_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipulse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipulse_sync_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'attendance_records',
        'attendance_upload_sessions',
        'employees',
        'employee_status_history',
        'biometric_clock_events',
        'leave_upload_batches',
        'leave_applications',
        'shift_rosters',
        'shift_roster_history',
        'shift_roster_change_events',
        'shift_sync_settings',
        'employee_update_upload_logs',
        'ipulse_config',
        'ipulse_sync_logs'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON TABLE
  public.attendance_records,
  public.attendance_upload_sessions,
  public.employees,
  public.employee_status_history,
  public.biometric_clock_events,
  public.leave_upload_batches,
  public.leave_applications,
  public.shift_rosters,
  public.shift_roster_history,
  public.shift_roster_change_events,
  public.shift_sync_settings,
  public.employee_update_upload_logs,
  public.ipulse_config,
  public.ipulse_sync_logs
FROM anon, authenticated;

-- Store assignments for Rep/Regional/Divisional roles
CREATE TABLE IF NOT EXISTS public.store_assignments (
  username TEXT PRIMARY KEY,
  store_keys JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.store_assignments ENABLE ROW LEVEL SECURITY;

-- Allow public read/write (same pattern as other tables in this project)
GRANT ALL ON public.store_assignments TO anon;
GRANT ALL ON public.store_assignments TO authenticated;

-- Devices table - persisted device registry with region assignments
CREATE TABLE IF NOT EXISTS public.devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  store_code TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  region TEXT DEFAULT '',
  device_type TEXT NOT NULL,
  reader_type TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'warning',
  connected TEXT DEFAULT '',
  has_time_and_attendance BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.devices TO anon;
GRANT ALL ON public.devices TO authenticated;

CREATE INDEX IF NOT EXISTS idx_devices_store_code ON public.devices(store_code);
CREATE INDEX IF NOT EXISTS idx_devices_region ON public.devices(region);
CREATE INDEX IF NOT EXISTS idx_devices_status ON public.devices(status);

-- =====================================================
-- PUBLIC ACCESS POLICIES (for anon/authenticated roles)
-- =====================================================

-- biometric_clock_events
GRANT SELECT ON public.biometric_clock_events TO anon;
GRANT INSERT ON public.biometric_clock_events TO anon;
GRANT UPDATE ON public.biometric_clock_events TO anon;
GRANT SELECT ON public.biometric_clock_events TO authenticated;
GRANT INSERT ON public.biometric_clock_events TO authenticated;
GRANT UPDATE ON public.biometric_clock_events TO authenticated;

DROP POLICY IF EXISTS "Allow public read biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public insert biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public update biometric clock events" ON biometric_clock_events;

CREATE POLICY "Allow public read biometric clock events" ON biometric_clock_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert biometric clock events" ON biometric_clock_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update biometric clock events" ON biometric_clock_events FOR UPDATE USING (true);

-- employees
GRANT SELECT ON public.employees TO anon;
GRANT INSERT ON public.employees TO anon;
GRANT UPDATE ON public.employees TO anon;
GRANT SELECT ON public.employees TO authenticated;
GRANT INSERT ON public.employees TO authenticated;
GRANT UPDATE ON public.employees TO authenticated;

DROP POLICY IF EXISTS "Allow public read employees" ON employees;
DROP POLICY IF EXISTS "Allow public insert employees" ON employees;
DROP POLICY IF EXISTS "Allow public update employees" ON employees;

CREATE POLICY "Allow public read employees" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow public insert employees" ON employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update employees" ON employees FOR UPDATE USING (true);

-- employee_status_history
GRANT SELECT ON public.employee_status_history TO anon;
GRANT INSERT ON public.employee_status_history TO anon;
GRANT SELECT ON public.employee_status_history TO authenticated;
GRANT INSERT ON public.employee_status_history TO authenticated;

DROP POLICY IF EXISTS "Allow public read employee status history" ON employee_status_history;
DROP POLICY IF EXISTS "Allow public insert employee status history" ON employee_status_history;

CREATE POLICY "Allow public read employee status history" ON employee_status_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert employee status history" ON employee_status_history FOR INSERT WITH CHECK (true);

-- attendance_records
GRANT SELECT ON public.attendance_records TO anon;
GRANT INSERT ON public.attendance_records TO anon;
GRANT UPDATE ON public.attendance_records TO anon;
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT INSERT ON public.attendance_records TO authenticated;
GRANT UPDATE ON public.attendance_records TO authenticated;

DROP POLICY IF EXISTS "Allow public read attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Allow public insert attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Allow public update attendance_records" ON attendance_records;

CREATE POLICY "Allow public read attendance_records" ON attendance_records FOR SELECT USING (true);
CREATE POLICY "Allow public insert attendance_records" ON attendance_records FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update attendance_records" ON attendance_records FOR UPDATE USING (true);

-- attendance_upload_sessions
GRANT SELECT ON public.attendance_upload_sessions TO anon;
GRANT INSERT ON public.attendance_upload_sessions TO anon;
GRANT SELECT ON public.attendance_upload_sessions TO authenticated;
GRANT INSERT ON public.attendance_upload_sessions TO authenticated;

DROP POLICY IF EXISTS "Allow public read attendance_upload_sessions" ON attendance_upload_sessions;
DROP POLICY IF EXISTS "Allow public insert attendance_upload_sessions" ON attendance_upload_sessions;

CREATE POLICY "Allow public read attendance_upload_sessions" ON attendance_upload_sessions FOR SELECT USING (true);
CREATE POLICY "Allow public insert attendance_upload_sessions" ON attendance_upload_sessions FOR INSERT WITH CHECK (true);

-- shift_rosters
GRANT SELECT ON public.shift_rosters TO anon;
GRANT INSERT ON public.shift_rosters TO anon;
GRANT UPDATE ON public.shift_rosters TO anon;
GRANT DELETE ON public.shift_rosters TO anon;
GRANT SELECT ON public.shift_rosters TO authenticated;
GRANT INSERT ON public.shift_rosters TO authenticated;
GRANT UPDATE ON public.shift_rosters TO authenticated;
GRANT DELETE ON public.shift_rosters TO authenticated;

DROP POLICY IF EXISTS "Allow public read shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public insert shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public update shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public delete shift rosters" ON shift_rosters;

CREATE POLICY "Allow public read shift rosters" ON shift_rosters FOR SELECT USING (true);
CREATE POLICY "Allow public insert shift rosters" ON shift_rosters FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update shift rosters" ON shift_rosters FOR UPDATE USING (true);
CREATE POLICY "Allow public delete shift rosters" ON shift_rosters FOR DELETE USING (true);

-- shift_roster_history
GRANT SELECT ON public.shift_roster_history TO anon;
GRANT INSERT ON public.shift_roster_history TO anon;
GRANT UPDATE ON public.shift_roster_history TO anon;
GRANT DELETE ON public.shift_roster_history TO anon;
GRANT SELECT ON public.shift_roster_history TO authenticated;
GRANT INSERT ON public.shift_roster_history TO authenticated;
GRANT UPDATE ON public.shift_roster_history TO authenticated;
GRANT DELETE ON public.shift_roster_history TO authenticated;

DROP POLICY IF EXISTS "Allow public read shift roster history" ON shift_roster_history;
DROP POLICY IF EXISTS "Allow public insert shift roster history" ON shift_roster_history;
DROP POLICY IF EXISTS "Allow public update shift roster history" ON shift_roster_history;
DROP POLICY IF EXISTS "Allow public delete shift roster history" ON shift_roster_history;

CREATE POLICY "Allow public read shift roster history" ON shift_roster_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert shift roster history" ON shift_roster_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update shift roster history" ON shift_roster_history FOR UPDATE USING (true);
CREATE POLICY "Allow public delete shift roster history" ON shift_roster_history FOR DELETE USING (true);

-- shift_roster_change_events
GRANT SELECT ON public.shift_roster_change_events TO anon;
GRANT INSERT ON public.shift_roster_change_events TO anon;
GRANT SELECT ON public.shift_roster_change_events TO authenticated;
GRANT INSERT ON public.shift_roster_change_events TO authenticated;

DROP POLICY IF EXISTS "Allow public read shift roster change events" ON shift_roster_change_events;
DROP POLICY IF EXISTS "Allow public insert shift roster change events" ON shift_roster_change_events;

CREATE POLICY "Allow public read shift roster change events" ON shift_roster_change_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert shift roster change events" ON shift_roster_change_events FOR INSERT WITH CHECK (true);

-- shift_sync_settings
GRANT SELECT ON public.shift_sync_settings TO anon;
GRANT INSERT ON public.shift_sync_settings TO anon;
GRANT UPDATE ON public.shift_sync_settings TO anon;
GRANT DELETE ON public.shift_sync_settings TO anon;
GRANT SELECT ON public.shift_sync_settings TO authenticated;
GRANT INSERT ON public.shift_sync_settings TO authenticated;
GRANT UPDATE ON public.shift_sync_settings TO authenticated;
GRANT DELETE ON public.shift_sync_settings TO authenticated;

DROP POLICY IF EXISTS "Allow public read shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public insert shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public update shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public delete shift sync settings" ON shift_sync_settings;

CREATE POLICY "Allow public read shift sync settings" ON shift_sync_settings FOR SELECT USING (true);
CREATE POLICY "Allow public insert shift sync settings" ON shift_sync_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update shift sync settings" ON shift_sync_settings FOR UPDATE USING (true);
CREATE POLICY "Allow public delete shift sync settings" ON shift_sync_settings FOR DELETE USING (true);

-- leave_applications
GRANT SELECT ON public.leave_applications TO anon;
GRANT INSERT ON public.leave_applications TO anon;
GRANT UPDATE ON public.leave_applications TO anon;
GRANT SELECT ON public.leave_applications TO authenticated;
GRANT INSERT ON public.leave_applications TO authenticated;
GRANT UPDATE ON public.leave_applications TO authenticated;

DROP POLICY IF EXISTS "Allow public read leave_applications" ON leave_applications;
DROP POLICY IF EXISTS "Allow public insert leave_applications" ON leave_applications;
DROP POLICY IF EXISTS "Allow public update leave_applications" ON leave_applications;

CREATE POLICY "Allow public read leave_applications" ON leave_applications FOR SELECT USING (true);
CREATE POLICY "Allow public insert leave_applications" ON leave_applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update leave_applications" ON leave_applications FOR UPDATE USING (true);

-- leave_upload_batches
GRANT SELECT ON public.leave_upload_batches TO anon;
GRANT INSERT ON public.leave_upload_batches TO anon;
GRANT SELECT ON public.leave_upload_batches TO authenticated;
GRANT INSERT ON public.leave_upload_batches TO authenticated;

DROP POLICY IF EXISTS "Allow public read leave_upload_batches" ON leave_upload_batches;
DROP POLICY IF EXISTS "Allow public insert leave_upload_batches" ON leave_upload_batches;

CREATE POLICY "Allow public read leave_upload_batches" ON leave_upload_batches FOR SELECT USING (true);
CREATE POLICY "Allow public insert leave_upload_batches" ON leave_upload_batches FOR INSERT WITH CHECK (true);

-- store_assignments
GRANT ALL ON public.store_assignments TO anon;
GRANT ALL ON public.store_assignments TO authenticated;

DROP POLICY IF EXISTS "Allow public read store_assignments" ON store_assignments;
DROP POLICY IF EXISTS "Allow public insert store_assignments" ON store_assignments;
DROP POLICY IF EXISTS "Allow public update store_assignments" ON store_assignments;

CREATE POLICY "Allow public read store_assignments" ON store_assignments FOR SELECT USING (true);
CREATE POLICY "Allow public insert store_assignments" ON store_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update store_assignments" ON store_assignments FOR UPDATE USING (true);

-- devices
GRANT SELECT ON public.devices TO anon;
GRANT INSERT ON public.devices TO anon;
GRANT UPDATE ON public.devices TO anon;
GRANT DELETE ON public.devices TO anon;
GRANT SELECT ON public.devices TO authenticated;
GRANT INSERT ON public.devices TO authenticated;
GRANT UPDATE ON public.devices TO authenticated;
GRANT DELETE ON public.devices TO authenticated;

DROP POLICY IF EXISTS "Allow public read devices" ON devices;
DROP POLICY IF EXISTS "Allow public insert devices" ON devices;
DROP POLICY IF EXISTS "Allow public update devices" ON devices;
DROP POLICY IF EXISTS "Allow public delete devices" ON devices;

CREATE POLICY "Allow public read devices" ON devices FOR SELECT USING (true);
CREATE POLICY "Allow public insert devices" ON devices FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update devices" ON devices FOR UPDATE USING (true);
CREATE POLICY "Allow public delete devices" ON devices FOR DELETE USING (true);

-- =====================================================
-- NEXT STEP
-- =====================================================
-- Run this SQL in Supabase Dashboard > SQL Editor
-- Then redeploy the app
