# Continue

This file is the live working memory for the current OpenCode/Josh Brain session.

Josh Brain must update this file after every meaningful user request, command result, code change, validation result, decision, subagent use, skill use, and next-step change.

# Continue - Time Attendance App Session

## Phrase to Continue
```
continue time attendance session
```

## Last Updated
2026-04-22

---

## What Was Done

### Session 1 (2026-04-20)

1. Read Obsidian Context
2. Verified App Status: Build passed, Lint had 82 pre-existing errors
3. Fixed Lint Errors (82 → 73): Removed unused imports in SuperAdminPanel, App.tsx, AuthApp.tsx
4. GitHub Token Issue: Push fails due to missing `workflow` scope on token
5. Deployed to Vercel: https://time-attendance-app-main.vercel.app
6. Created Rep Users: rep1/2/3@pfm.co.za (password: Rep123) in auth.ts
7. Restricted Rep Role Sidebar: Overview, Shifts, Calendar only
8. Committed locally: 621d164 "Add sample rep users (rep1, rep2, rep3)"

### Session 2 (2026-04-22) — Unstaged Changes

#### 9. Rep Self-Registration System
- **auth.ts**: Added `registerRep()` function — validates fields, checks duplicate usernames, creates rep user
- **AuthApp.tsx**: Added 3-step enrollment flow:
  - Step 1: Sign In (existing form)
  - Step 2: Enrollment Code — enter company code "PFM" to verify
  - Step 3: Sign Up — name, surname, email, password + confirm → auto-creates rep account + logs in
- Enrollment code: `PFM` (hardcoded in AuthApp.tsx)

#### 10. Device Data Overhaul (App.tsx)
- Replaced old `DeviceRecord` type with richer type: storeCode, storeName, deviceType, readerType, hasTimeAndAttendance, connected
- Added `StoreDeviceStatus` type and `storeDeviceMap` useMemo + `storeHasDevice` callback
- Overview now filters employees/attendance/clock events to only include stores with physical devices
- New `parseDeviceWorkbook()` handles real device export format (serial number, device type, reader type, status, connected)
- Devices page redesigned: shows Physical/Logical store counts, has-device badges in table
- Moved device upload button into Devices page (removed from Overview)

#### 11. Overview Performance Optimization (App.tsx)
- Parallelized ALL API calls using `Promise.all` (was sequential awaits)
- Added `performance.now()` logging for each step
- Shift sync settings and config now fetched in parallel (not sequential)
- Overview data filtered by storeDeviceMap (stores without physical devices excluded from counts)

#### 12. Supabase-First Data Layer (database.ts, leave.ts, clockData.ts)
- `getAttendanceByDate()` / `getAttendanceByDateRange()`: fetch directly from Supabase, local fallback only on error
- `getEmployees()`: returns Supabase data directly, local fallback only on error
- `getLeaveApplications()`: removed redundant schema refresh query, removed merge step, returns Supabase data directly
- Added `getClockEventsForDateRange()` in clockData.ts — dedicated date-range query with Supabase-first approach
- Replaced all `getClockEvents()` calls with `getClockEventsForDateRange()`

#### 13. ClockDataHub Cache Removal (ClockDataHub.tsx)
- Removed localStorage caching (CLOCK_CACHE_KEY, loadClockCache, saveClockCache)
- Removed background refresh logic
- Simplified to direct Supabase fetch each time
- Status messages now say "from Supabase" instead of "optimized clock store"

#### 14. Reports with Device Badges (ReportsBuilder.tsx)
- Added `storeDeviceMap` prop
- Reports show "Physical Store (Has Device)" / "Logical Store (No Device)" badges
- Badges appear in PDF export, HTML export, and dark-mode printout
- Added CSS for `.device-badge` in both light and dark export themes

#### 15. SuperAdminPanel Password Management (SuperAdminPanel.tsx)
- Added show/hide password toggle per user (Eye/EyeOff icons)
- Added copy password button (Copy/Check icons)
- Passwords displayed in styled container with reveal/copy actions
- Added `visiblePasswords` and `copiedPassword` state

---

## Current State
- **App URL**: https://time-attendance-app-main.vercel.app
- **Login**: josh@pfm.co.za / PFM@dmin2026! (super_admin)
- **Rep Users**: rep1, rep2, rep3 (password: Rep123) — seeded in auth.ts
- **Self-Registration**: Enrollment code `PFM` → creates rep account with Overview, Shifts, Calendar access
- **Build**: Passing
- **Lint**: 78 errors (71 errors, 7 warnings) — mostly unused variables
- **Git**: Clean, up-to-date with origin/main (all changes committed and pushed)

---

## Files Modified (Committed & Pushed)
All changes committed and pushed to GitHub:
1. `src/App.tsx` — Device overhaul, overview optimization, Supabase-first, store device filtering
2. `src/AuthApp.tsx` — 3-step enrollment flow (signin → enrollment code → signup)
3. `src/components/ClockDataHub.tsx` — Removed localStorage cache, simplified to Supabase-first
4. `src/components/ReportsBuilder.tsx` — Device badges in reports (PDF/HTML/dark mode)
5. `src/components/SuperAdminPanel.tsx` — Password show/hide/copy
6. `src/services/auth.ts` — Added `registerRep()` function
7. `src/services/clockData.ts` — Added `getClockEventsForDateRange()`
8. `src/services/database.ts` — Supabase-first for attendance + employees queries
9. `src/services/leave.ts` — Supabase-first for leave applications

---

## Commands Used
```bash
npm run build          # Build app
npm run lint           # Check lint errors
npx vercel --prod     # Deploy to Vercel
git add -A            # Stage all changes
git commit -m ""       # Commit changes
git push origin main   # Push to GitHub (fails due to token)
```

---

## Where We Left Off
- App is deployed and working with all the new features above
- All changes have been committed and pushed to GitHub
- App automatically deployed to Vercel via GitHub integration

---

## To Continue Next Time
1. Login to app: https://time-attendance-app-main.vercel.app
2. Super Admin: josh@pfm.co.za / PFM@dmin2026!
3. Rep self-registration: Click "Sign up" → enter code "PFM" → fill details
4. Rep users: rep1@pfm.co.za, rep2@pfm.co.za, rep3@pfm.co.za (password: Rep123)

## Fix GitHub Token
Run this to fix token scope:
```bash
gh auth refresh -s workflow -h github.com
```
Then push commits with: `git push origin main`

## FIX: Supabase RLS Policies (CRITICAL)
The clock data wasn't loading because `supabase-setup.sql` **REVOKED all privileges** from anon/authenticated but never created policies to re-grant access.

### Solution - Run SQL in Supabase Dashboard
1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql
2. Copy and run the new policy section from `supabase-setup.sql` (lines 343-485)

Or run this minimal fix:
```sql
-- biometric_clock_events (CRITICAL for clocks)
GRANT SELECT ON public.biometric_clock_events TO anon;
GRANT INSERT ON public.biometric_clock_events TO anon;
GRANT UPDATE ON public.biometric_clock_events TO anon;

DROP POLICY IF EXISTS "Allow public read biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public insert biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public update biometric clock events" ON biometric_clock_events;

CREATE POLICY "Allow public read biometric clock events" ON biometric_clock_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert biometric clock events" ON biometric_clock_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update biometric clock events" ON biometric_clock_events FOR UPDATE USING (true);

-- employees (for employee profile loading)
GRANT SELECT ON public.employees TO anon;
GRANT INSERT ON public.employees TO anon;
GRANT UPDATE ON public.employees TO anon;

DROP POLICY IF EXISTS "Allow public read employees" ON employees;
DROP POLICY IF EXISTS "Allow public insert employees" ON employees;
DROP POLICY IF EXISTS "Allow public update employees" ON employees;

CREATE POLICY "Allow public read employees" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow public insert employees" ON employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update employees" ON employees FOR UPDATE USING (true);
```

## Pending Actions
- [ ] Clean up lint errors (79 remaining)
- [ ] Run RLS policy fix in Supabase dashboard

## Session Log - 2026-04-27

### Startup Entry
- Project: time-attendance-app (v0.0.2, React 19 + Vite 8 + Supabase)
- Path: C:\Users\joshm\Desktop\App\EMBER WEB\time-attendance-app-main\time-attendance-app-main
- Branch: main (up to date with origin/main)
- Startup Time: 2026-04-27
- Current Status:
  - Git: Unstaged changes to continue.md, untracked route-list-test.xlsx
  - Build: Passing (npm run build succeeds)
  - Lint: 78 errors (71 errors, 7 warnings) — mostly unused variables
  - Deployment: Live at https://time-attendance-app-main.vercel.app
  - Pending: Supabase RLS policy fix for clock data access, lint cleanup
- Next Safest Step: Confirm Josh Brain refresh complete, summarize project, recommend first subagent (no source code edits until user requests)
