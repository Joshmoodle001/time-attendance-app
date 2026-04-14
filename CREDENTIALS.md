# Credentials

## Default Super Admin

| Field | Value |
|-------|-------|
| Username | `Josh@pfm.co.za` |
| Password | `PFM@dmin2026!` |
| Role | `super_admin` |

Hardcoded in [src/services/auth.ts](src/services/auth.ts) as `DEFAULT_SUPER_ADMIN_USERNAME` and `DEFAULT_SUPER_ADMIN_SECRET`. Auto-seeded into localStorage on first load and re-synced on every app start, so this account always works even if browser storage was cleared.

## Local Dev

- URL: http://localhost:5188
- Start: `npm run dev -- --port 5188 --strictPort`
- Or double-click `Time Attendance Dashboard.bat` on the desktop
