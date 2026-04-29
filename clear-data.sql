-- =====================================================
-- CLEAR ALL APPLICATION DATA (KEEP CALENDAR)
-- Run this in: Supabase Dashboard > SQL Editor
-- =====================================================

-- Clear in order (respecting foreign key constraints)
DELETE FROM biometric_clock_events;
DELETE FROM attendance_records;
DELETE FROM attendance_upload_sessions;
DELETE FROM shift_rosters;
DELETE FROM shift_roster_history;
DELETE FROM shift_roster_change_events;
DELETE FROM shift_sync_settings;
DELETE FROM employee_update_upload_logs;
DELETE FROM leave_applications;
DELETE FROM leave_upload_batches;
DELETE FROM employee_status_history;
DELETE FROM employees;
DELETE FROM store_assignments;
DELETE FROM ipulse_sync_logs;
DELETE FROM ipulse_config;

-- Reset shift_sync_settings to default
INSERT INTO shift_sync_settings (id, auto_sync_enabled, payload, updated_at) 
VALUES ('global', false, '{"sections":[]}', NOW())
ON CONFLICT (id) DO UPDATE SET 
  auto_sync_enabled = false,
  payload = '{"sections":[]}',
  updated_at = NOW();

-- Verify counts
SELECT 
  'attendance_records' as table_name, COUNT(*) as row_count FROM attendance_records
UNION ALL SELECT 'biometric_clock_events', COUNT(*) FROM biometric_clock_events
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'employee_status_history', COUNT(*) FROM employee_status_history
UNION ALL SELECT 'shift_rosters', COUNT(*) FROM shift_rosters
UNION ALL SELECT 'shift_roster_history', COUNT(*) FROM shift_roster_history
UNION ALL SELECT 'leave_applications', COUNT(*) FROM leave_applications
UNION ALL SELECT 'store_assignments', COUNT(*) FROM store_assignments
UNION ALL SELECT 'ipulse_sync_logs', COUNT(*) FROM ipulse_sync_logs;
