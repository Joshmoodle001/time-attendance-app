## Session Log - 2026-04-29

### 14:02 - Fix Supabase Employee Loading Issue
- User reported: App not calling employees from Supabase, only keeping uploaded data
- Action taken: Explored codebase to find root cause
- Findings:
  - No `.env` file existed (Supabase not configured)
  - Employee source mode likely set to "local" in localStorage
  - App falls back to localStorage/IndexedDB when Supabase unavailable
- Files changed:
  - Created `.env` template at `time-attendance-app-main/.env`
- Commands run:
  - `npm run dev` - started dev server on http://localhost:5173
- Agents used:
  - `@repo-mapper` - explored project structure
- Validation:
  - Dev server started successfully
  - `.env` file created (needs real credentials)
- Result:
  - Identified 3 issues preventing Supabase employee loading
  - Provided step-by-step fix guide
- Next step:
  1. User must edit `.env` with real Supabase URL and anon key
  2. Run `supabase-setup.sql` in Supabase Dashboard SQL Editor
  3. Clear `employee-source-mode-v1` from browser localStorage
  4. Refresh app - employees should load from Supabase
- Remember:
  - App checks `loadEmployeeSourceMode()` - if "local", never queries Supabase
  - `src/services/database.ts:1273-1278` - local mode check
  - `src/lib/supabase.ts` - Supabase client config with env vars
  - Without `.env`, `isSupabaseConfigured` is false, app runs in local-only mode
