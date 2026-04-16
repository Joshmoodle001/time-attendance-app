-- Fix missing DELETE policies for Admin Data Reset
-- Run this in Supabase Dashboard > SQL Editor

-- Some environments were created without DELETE policies for the shift reset tables.
-- That causes Admin Data Reset to report that shift_rosters could not be fully cleared.

DROP POLICY IF EXISTS "Allow public delete shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Public Delete shift rosters" ON shift_rosters;
CREATE POLICY "Allow public delete shift rosters" ON shift_rosters
  FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow public delete shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Public Delete shift sync settings" ON shift_sync_settings;
CREATE POLICY "Allow public delete shift sync settings" ON shift_sync_settings
  FOR DELETE USING (true);

-- Optional verification
SELECT 'shift_rosters' AS table_name, COUNT(*) AS remaining_rows FROM shift_rosters
UNION ALL
SELECT 'shift_sync_settings' AS table_name, COUNT(*) AS remaining_rows FROM shift_sync_settings;
