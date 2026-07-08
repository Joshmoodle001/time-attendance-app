-- =============================================================
-- PFM BIOSYNC — STORAGE BUCKET RLS POLICIES
-- Run this in Supabase SQL Editor immediately
-- Project: aawtapigafrzxfeojvlh
-- =============================================================

-- Allow anon to upload files to the attendance-files bucket
CREATE POLICY IF NOT EXISTS "Allow anon upload attendance-files"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'attendance-files');

-- Allow anon to download/read files from the attendance-files bucket
CREATE POLICY IF NOT EXISTS "Allow anon select attendance-files"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'attendance-files');

-- Allow anon to delete files from the attendance-files bucket
CREATE POLICY IF NOT EXISTS "Allow anon delete attendance-files"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'attendance-files');

-- Verify bucket exists
SELECT name, public FROM storage.buckets WHERE name = 'attendance-files';
