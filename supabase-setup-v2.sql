-- =====================================================
-- ATTENDANCE DATABASE SETUP FOR SUPABASE (v2)
-- Run this after supabase-setup.sql, or use it as the
-- required policy patch for environments created from the
-- older setup file.
-- =====================================================

-- Ensure the reset-related policies are idempotent
DROP POLICY IF EXISTS "Allow public read shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public insert shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public update shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public delete shift rosters" ON shift_rosters;

CREATE POLICY "Allow public read shift rosters" ON shift_rosters
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert shift rosters" ON shift_rosters
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update shift rosters" ON shift_rosters
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete shift rosters" ON shift_rosters
  FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow public read shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public insert shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public update shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public delete shift sync settings" ON shift_sync_settings;

CREATE POLICY "Allow public read shift sync settings" ON shift_sync_settings
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert shift sync settings" ON shift_sync_settings
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update shift sync settings" ON shift_sync_settings
  FOR UPDATE USING (true);

CREATE POLICY "Allow public delete shift sync settings" ON shift_sync_settings
  FOR DELETE USING (true);

-- Optional verification
SELECT 'shift_rosters' AS table_name, COUNT(*) AS remaining_rows FROM shift_rosters
UNION ALL
SELECT 'shift_sync_settings' AS table_name, COUNT(*) AS remaining_rows FROM shift_sync_settings;
