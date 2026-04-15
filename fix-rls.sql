-- Fix RLS policies for shift_sync_settings table
-- Run this in Supabase SQL Editor

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow public read shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public insert shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow public update shift sync settings" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow anon read" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow anon insert" ON shift_sync_settings;
DROP POLICY IF EXISTS "Allow anon update" ON shift_sync_settings;

-- Create new policies for anon role
CREATE POLICY "Allow anon read" ON shift_sync_settings FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON shift_sync_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON shift_sync_settings FOR UPDATE USING (true);

-- Grant permissions to anon role
GRANT ALL ON shift_sync_settings TO anon;
GRANT ALL ON shift_sync_settings TO authenticated;
GRANT ALL ON shift_sync_settings TO service_role;

-- =====================================================
-- Fix RLS policies for shift_rosters table
-- =====================================================

DROP POLICY IF EXISTS "Allow public read shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public insert shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow public update shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow anon read shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow anon insert shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow anon update shift rosters" ON shift_rosters;
DROP POLICY IF EXISTS "Allow anon delete shift rosters" ON shift_rosters;

CREATE POLICY "Allow anon read" ON shift_rosters FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON shift_rosters FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON shift_rosters FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete" ON shift_rosters FOR DELETE USING (true);

GRANT ALL ON shift_rosters TO anon;
GRANT ALL ON shift_rosters TO authenticated;
GRANT ALL ON shift_rosters TO service_role;