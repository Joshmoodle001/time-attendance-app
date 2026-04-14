# Time Attendance Operations Backend

A React + TypeScript dashboard for managing employee attendance, integrations, and workforce operations.

## Features

- **Overview Dashboard** - KPI cards, pie charts, trend analysis, live event feed
- **Attendance Management** - Excel file import with cloud storage (Supabase)
- **Employee Directory** - Searchable/filterable employee table with hierarchy
- **Integrations** - API connection health monitoring and sync management

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts
- **Animations**: Framer Motion
- **Storage**: Supabase (file uploads)
- **Icons**: Lucide React

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase Storage

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Storage** → **Create bucket** named `attendance-files`
3. Set bucket to **Public**
4. Copy your **Project URL** and **anon key** from **Settings → API**
5. Create a `.env.local` file:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Set Up Supabase Database Tables

Run the bootstrap script with a Supabase management token that has `database_write` permission:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-database.ps1 -AccessToken "your-supabase-token"
```

If you only need the biometric clock table manually, run the SQL in `supabase-clock-setup.sql` from the Supabase SQL Editor.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy!

### Supabase Storage Setup

Make sure your Supabase bucket policy allows public read access:

```sql
-- In Supabase SQL Editor
create policy "Public Read" on storage.objects
  for select using (bucket_id = 'attendance-files');

create policy "Public Upload" on storage.objects
  for insert with check (bucket_id = 'attendance-files');
```

## Build

```bash
npm run build
```

Output is in the `dist/` directory.

## Project Structure

```
src/
├── App.tsx           # Main application
├── components/ui/    # UI components (Card, Button, etc.)
├── lib/
│   ├── supabase.ts   # Supabase client
│   └── utils.ts      # Utility functions
└── services/
    └── storage.ts    # File upload/download service
```
