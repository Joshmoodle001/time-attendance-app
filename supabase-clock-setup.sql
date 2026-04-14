-- =====================================================
-- CLOCK DATA SETUP FOR SUPABASE
-- Run this in: Supabase Dashboard > SQL Editor
-- =====================================================

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

CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_employee_code ON biometric_clock_events(employee_code);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clock_date ON biometric_clock_events(clock_date DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clocked_at ON biometric_clock_events(clocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_id_number ON biometric_clock_events(id_number);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_store ON biometric_clock_events(store);

DROP POLICY IF EXISTS "Allow public read biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public insert biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public update biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public delete biometric clock events" ON biometric_clock_events;

CREATE POLICY "Allow public read biometric clock events" ON biometric_clock_events
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert biometric clock events" ON biometric_clock_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update biometric clock events" ON biometric_clock_events
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete biometric clock events" ON biometric_clock_events
  FOR DELETE USING (true);
