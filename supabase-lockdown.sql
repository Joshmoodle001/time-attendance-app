BEGIN;

ALTER TABLE IF EXISTS public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attendance_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.biometric_clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.leave_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shift_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shift_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_update_upload_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ipulse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ipulse_sync_logs ENABLE ROW LEVEL SECURITY;

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

COMMIT;
