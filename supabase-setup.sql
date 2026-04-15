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
ALTER TABLE shift_sync_settings ENABLE ROW LEVEL SECURITY;
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
        'biometric_clock_events',
        'leave_upload_batches',
        'leave_applications',
        'shift_rosters',
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
  public.biometric_clock_events,
  public.leave_upload_batches,
  public.leave_applications,
  public.shift_rosters,
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

-- =====================================================
-- NEXT STEP
-- =====================================================
-- Add authenticated, least-privilege policies only after introducing real auth
-- and moving privileged writes plus iPulse secret handling to server-side code.
