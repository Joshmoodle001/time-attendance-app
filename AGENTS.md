# Time Attendance App

React 19 + TypeScript + Vite app with Supabase backend for employee attendance management.

## Commands

```bash
npm run dev      # Dev server (localhost:5173)
npm run build    # TypeScript check + production build
npm run lint     # ESLint
npm run preview  # Preview production build locally
```

**No test suite exists.** CI only runs `npm run build`.

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS |
| Backend | Supabase (Postgres + Storage) |
| Deployment | Vercel (SSR with `/api` serverless functions) |
| CI/CD | GitHub Actions |

### Key Files

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Main SPA with lazy-loaded feature hubs |
| `src/lib/supabase.ts` | Supabase client (checks env vars at runtime) |
| `src/services/` | Data access layer (database, storage, shifts, ipulse, etc.) |
| `api/*.js` | Vercel serverless functions (shift sync, health) |
| `supabase-setup.sql` | Complete database schema (tables, RLS, indexes) |
| `vite.config.ts` | Build config + **dev-only Google Sheets proxy plugin** |

### Dev Proxy (Important)

`vite.config.ts` has a custom plugin that proxies `/api/download-shift` requests to Google Sheets/Drive. This enables local shift sync without CORS issues. The same logic runs in the Vercel serverless function in production.

## Environment Variables

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Required in `.env.local` (local dev) and Vercel environment variables (production).

## Database Setup

Run `supabase-setup.sql` via Supabase SQL Editor, or trigger the `Supabase Schema Sync` GitHub Actions workflow manually.

## Deployment

1. Push to GitHub
2. Import project in Vercel
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Deploy

Supabase storage requires a public bucket named `attendance-files` with read/insert policies.

## GitHub Actions Secrets

| Secret | Purpose |
|--------|---------|
| `SHIFT_SYNC_URL` | Production cron trigger URL |
| `SHIFT_SYNC_CRON_TOKEN` | Auth token for cron endpoint |
| `SUPABASE_ACCESS_TOKEN` | Schema sync workflow |
| `SUPABASE_PROJECT_REF` | Supabase project ID |

## Additional Docs

- `docs/github-actions-shift-sync.md` - Automated shift sync setup
- `CREDENTIALS.md` - Credential handling notes
