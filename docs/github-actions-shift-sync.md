# GitHub Actions Shift Sync Setup

This app now supports autonomous hourly shift sync through GitHub Actions.

## Required GitHub Secrets

Add these repository secrets in GitHub:

- `SHIFT_SYNC_URL`
  - Example: `https://time-attendance-app-nu.vercel.app/api/shift-sync-cron`
- `SHIFT_SYNC_CRON_TOKEN`
  - Any long random secret string
- `SUPABASE_ACCESS_TOKEN`
  - Required for the manual `Supabase Schema Sync` workflow
- `SUPABASE_PROJECT_REF`
  - Example: `bkmlqnmnxkeibmrcpefp`

## Required Vercel Environment Variable

Add this environment variable in Vercel for Production:

- `SHIFT_SYNC_CRON_TOKEN`
  - Must match the GitHub secret of the same name

## Required Supabase Table

The autonomous sync uses the `shift_sync_settings` table added in `supabase-setup.sql`.

Run either:

- the `Supabase Schema Sync` GitHub Actions workflow

or

- the SQL manually in Supabase SQL Editor

## Workflows Added

- `CI`
  - Builds the app on push and pull requests
- `Hourly Shift Sync`
  - Calls the production background sync route every hour
- `Supabase Schema Sync`
  - Applies `supabase-setup.sql` to Supabase on demand

## How It Works

1. The app stores the four shift links in `shift_sync_settings`
2. GitHub Actions runs every hour
3. GitHub calls `/api/shift-sync-cron`
4. The server downloads all linked Google files
5. The synced rosters are merged into `shift_rosters`
6. The app shows the updated `last synced` times as proof
