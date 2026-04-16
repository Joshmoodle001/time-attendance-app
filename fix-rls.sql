-- Fix RLS policies for all tables
-- Run this in Supabase Dashboard > SQL Editor

-- Drop existing policies and recreate
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

-- Grant permissions
GRANT ALL ON TABLE attendance_records TO anon, authenticated;
GRANT ALL ON TABLE attendance_upload_sessions TO anon, authenticated;
GRANT ALL ON TABLE employees TO anon, authenticated;
GRANT ALL ON TABLE biometric_clock_events TO anon, authenticated;
GRANT ALL ON TABLE leave_upload_batches TO anon, authenticated;
GRANT ALL ON TABLE leave_applications TO anon, authenticated;
GRANT ALL ON TABLE shift_rosters TO anon, authenticated;
GRANT ALL ON TABLE shift_sync_settings TO anon, authenticated;
GRANT ALL ON TABLE employee_update_upload_logs TO anon, authenticated;
GRANT ALL ON TABLE ipulse_config TO anon, authenticated;
GRANT ALL ON TABLE ipulse_sync_logs TO anon, authenticated;

-- Create permissive policies
CREATE POLICY "Allow all access employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access attendance_records" ON attendance_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access biometric_clock_events" ON biometric_clock_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access leave_applications" ON leave_applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access leave_upload_batches" ON leave_upload_batches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access shift_rosters" ON shift_rosters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access shift_sync_settings" ON shift_sync_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access attendance_upload_sessions" ON attendance_upload_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access employee_update_upload_logs" ON employee_update_upload_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access ipulse_config" ON ipulse_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access ipulse_sync_logs" ON ipulse_sync_logs FOR ALL USING (true) WITH CHECK (true);

-- Verify
SELECT 'employees' AS table_name, COUNT(*) AS row_count FROM employees
UNION ALL
SELECT 'attendance_records' AS table_name, COUNT(*) AS row_count FROM attendance_records;
