-- =============================================================
-- PFM BIOSYNC — TIME & ATTENDANCE COMPANION APP
-- Supabase Database Setup (single-run)
-- =============================================================
-- Project: aawtapigafrzxfeojvlh
-- App URL: https://time-attendance-app-amber.vercel.app
-- Purpose : Reporting System Companion App — attendance, coversheets,
--           shift rosters, clock data, leave, iPulse sync, employees.
-- =============================================================
-- Paste this ENTIRE file into Supabase SQL Editor and click Run.
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS).
-- =============================================================

-- ── 1. EMPLOYEES ────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_employees_id_number ON employees(id_number);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_store_status_active ON employees(store) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_employees_region_store ON employees(region, store);

-- ── 2. ATTENDANCE RECORDS ───────────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_attendance_upload_date ON attendance_records(upload_date);
CREATE INDEX IF NOT EXISTS idx_attendance_region ON attendance_records(region);
CREATE INDEX IF NOT EXISTS idx_attendance_store ON attendance_records(store);
CREATE INDEX IF NOT EXISTS idx_attendance_region_store ON attendance_records(region, store);

-- ── 3. ATTENDANCE UPLOAD SESSIONS ──────────────────────────

CREATE TABLE IF NOT EXISTS attendance_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_date DATE NOT NULL UNIQUE,
  file_name TEXT,
  record_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_upload_sessions(upload_date DESC);

-- ── 4. BIOMETRIC CLOCK EVENTS ──────────────────────────────

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clock_events_employee_code ON biometric_clock_events(employee_code);
CREATE INDEX IF NOT EXISTS idx_clock_events_clock_date ON biometric_clock_events(clock_date DESC);
CREATE INDEX IF NOT EXISTS idx_clock_events_clocked_at ON biometric_clock_events(clocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_clock_events_id_number ON biometric_clock_events(id_number);
CREATE INDEX IF NOT EXISTS idx_clock_events_store ON biometric_clock_events(store);
CREATE INDEX IF NOT EXISTS idx_clock_events_date_employee ON biometric_clock_events(clock_date, employee_code);

-- ── 5. SHIFT ROSTERS ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_name TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  store_code TEXT,
  source_file_name TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_rosters_updated_at ON shift_rosters(updated_at DESC);

-- ── 6. SHIFT SYNC SETTINGS (also stores coversheet pointer) ─
--     id = 'global'           → shift sync configuration
--     id = 'coversheet-upload'→ latest coversheet file pointer

CREATE TABLE IF NOT EXISTS shift_sync_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  last_universal_synced_at TIMESTAMPTZ,
  last_universal_status TEXT DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_sync_settings_updated_at ON shift_sync_settings(updated_at DESC);

-- ── 7. LEAVE UPLOAD BATCHES ────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  applied_rows INTEGER DEFAULT 0,
  unmatched_rows INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_upload_batches_created_at ON leave_upload_batches(created_at DESC);

-- ── 8. LEAVE APPLICATIONS ──────────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_leave_applications_batch_id ON leave_applications(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee_code ON leave_applications(matched_employee_code);
CREATE INDEX IF NOT EXISTS idx_leave_applications_start_date ON leave_applications(leave_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_applications_end_date ON leave_applications(leave_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_applications_status ON leave_applications(apply_status);

-- ── 9. EMPLOYEE UPDATE UPLOAD LOGS ─────────────────────────

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
  rolled_back_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_update_upload_logs_created_at
  ON employee_update_upload_logs(created_at DESC);

-- ── 10. IPULSE CONFIG ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS ipulse_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  api_secret TEXT NOT NULL DEFAULT '',
  sync_interval_minutes INTEGER DEFAULT 60,
  auto_sync_enabled BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'error', 'partial', 'pending')),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 11. IPULSE SYNC LOGS ───────────────────────────────────

CREATE TABLE IF NOT EXISTS ipulse_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'error', 'partial')),
  employees_synced INTEGER DEFAULT 0,
  attendance_synced INTEGER DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_seconds NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_ipulse_sync_logs_started ON ipulse_sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipulse_sync_logs_status ON ipulse_sync_logs(status);

-- ── PERFORMANCE VIEWS ──────────────────────────────────────

CREATE OR REPLACE VIEW clock_overview_stats AS
SELECT 
  COUNT(*) as total_events,
  COUNT(DISTINCT employee_code) as employees_with_clocks,
  COUNT(*) FILTER (WHERE access_verified = true) as verified_events,
  COUNT(DISTINCT clock_date) as total_days,
  COUNT(DISTINCT store) FILTER (WHERE store != '') as total_stores
FROM biometric_clock_events;

CREATE OR REPLACE VIEW employee_clock_summaries AS
SELECT 
  employee_code,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE access_verified = true) as verified_events,
  MAX(clocked_at) as last_clocked_at,
  ARRAY_AGG(DISTINCT store) FILTER (WHERE store != '') as stores
FROM biometric_clock_events
GROUP BY employee_code;

CREATE OR REPLACE FUNCTION get_clock_overview_stats(p_start_date DATE, p_end_date DATE)
RETURNS TABLE (
  total_events BIGINT,
  employees_with_clocks BIGINT,
  verified_events BIGINT,
  total_days BIGINT,
  stores TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT,
    COUNT(DISTINCT employee_code)::BIGINT,
    COUNT(*) FILTER (WHERE access_verified = true)::BIGINT,
    COUNT(DISTINCT clock_date)::BIGINT,
    ARRAY_AGG(DISTINCT store) FILTER (WHERE store != '')::TEXT[]
  FROM biometric_clock_events
  WHERE clock_date >= p_start_date AND clock_date <= p_end_date;
END;
$$ LANGUAGE plpgsql;

-- ── RLS: ENABLE ROW LEVEL SECURITY ON ALL TABLES ───────────

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_update_upload_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipulse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipulse_sync_logs ENABLE ROW LEVEL SECURITY;

-- ── RLS: DROP ANY STALE POLICIES ───────────────────────────

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'employees', 'attendance_records', 'attendance_upload_sessions',
        'biometric_clock_events', 'shift_rosters', 'shift_sync_settings',
        'leave_upload_batches', 'leave_applications',
        'employee_update_upload_logs', 'ipulse_config', 'ipulse_sync_logs'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ── RLS: GRANT FULL ACCESS (companion app uses anon key) ───

GRANT ALL ON TABLE employees TO anon, authenticated;
GRANT ALL ON TABLE attendance_records TO anon, authenticated;
GRANT ALL ON TABLE attendance_upload_sessions TO anon, authenticated;
GRANT ALL ON TABLE biometric_clock_events TO anon, authenticated;
GRANT ALL ON TABLE shift_rosters TO anon, authenticated;
GRANT ALL ON TABLE shift_sync_settings TO anon, authenticated;
GRANT ALL ON TABLE leave_upload_batches TO anon, authenticated;
GRANT ALL ON TABLE leave_applications TO anon, authenticated;
GRANT ALL ON TABLE employee_update_upload_logs TO anon, authenticated;
GRANT ALL ON TABLE ipulse_config TO anon, authenticated;
GRANT ALL ON TABLE ipulse_sync_logs TO anon, authenticated;

GRANT SELECT ON clock_overview_stats TO anon, authenticated;
GRANT SELECT ON employee_clock_summaries TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_clock_overview_stats TO anon, authenticated;

-- ── RLS: CREATE PERMISSIVE POLICIES ────────────────────────

CREATE POLICY "Allow all access employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access attendance_records" ON attendance_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access attendance_upload_sessions" ON attendance_upload_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access biometric_clock_events" ON biometric_clock_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access shift_rosters" ON shift_rosters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access shift_sync_settings" ON shift_sync_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access leave_upload_batches" ON leave_upload_batches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access leave_applications" ON leave_applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access employee_update_upload_logs" ON employee_update_upload_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access ipulse_config" ON ipulse_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access ipulse_sync_logs" ON ipulse_sync_logs FOR ALL USING (true) WITH CHECK (true);

-- ── VERIFICATION ───────────────────────────────────────────

SELECT 'employees' AS table_name, COUNT(*) AS row_count FROM employees
UNION ALL SELECT 'attendance_records', COUNT(*) FROM attendance_records
UNION ALL SELECT 'attendance_upload_sessions', COUNT(*) FROM attendance_upload_sessions
UNION ALL SELECT 'biometric_clock_events', COUNT(*) FROM biometric_clock_events
UNION ALL SELECT 'shift_rosters', COUNT(*) FROM shift_rosters
UNION ALL SELECT 'shift_sync_settings', COUNT(*) FROM shift_sync_settings
UNION ALL SELECT 'leave_upload_batches', COUNT(*) FROM leave_upload_batches
UNION ALL SELECT 'leave_applications', COUNT(*) FROM leave_applications
UNION ALL SELECT 'employee_update_upload_logs', COUNT(*) FROM employee_update_upload_logs
UNION ALL SELECT 'ipulse_config', COUNT(*) FROM ipulse_config
UNION ALL SELECT 'ipulse_sync_logs', COUNT(*) FROM ipulse_sync_logs;

-- =============================================================
-- DONE. The companion app is ready to use this Supabase project.
-- Storage bucket 'attendance-files' must be created manually in
-- the Supabase Dashboard > Storage (private bucket, 50MB limit).
-- =============================================================
