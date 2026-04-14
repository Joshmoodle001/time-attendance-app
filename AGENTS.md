# Time Attendance App - Deployment Guide

## Quick Deploy Commands

### Prerequisites
- Node.js 18+
- GitHub account
- Vercel account
- Supabase account

---

## Step 1: Supabase Setup

### 1.1 Create Supabase Project
1. Go to https://supabase.com
2. Click "New Project"
3. Enter:
   - Name: `time-attendance-app`
   - Database Password: [create strong password]
   - Region: [closest to your users]
4. Click "Create new project"
5. Wait 2-3 minutes for setup

### 1.2 Get Credentials
1. Go to Settings (⚙️) → API
2. Copy:
   - **Project URL** (格式: `https://xxxxx.supabase.co`)
   - **anon public** key (under "Project API keys")

### 1.3 Initialize Database
**Option A: Using Supabase CLI (Recommended)**
```bash
# Install CLI
npm install -g supabase

# Login
supabase login

# Link project (get project-ref from Supabase dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF

# Push schema
supabase db push
```

**Option B: Via Dashboard SQL Editor**
1. Go to SQL Editor in Supabase dashboard
2. Copy contents of `supabase-setup.sql`
3. Run (click "Run" or Ctrl+Enter)

---

## Step 2: GitHub Setup

### 2.1 Push Code to GitHub
```bash
# If not initialized
git init
git add .
git commit -m "Initial commit"

# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/time-attendance-app.git
git push -u origin main
```

---

## Step 3: Vercel Deployment

### 3.1 Connect GitHub to Vercel
1. Go to https://vercel.com
2. Click "Add New" → Project
3. Import from GitHub: select your repo

### 3.2 Configure Environment Variables
In Vercel project settings → Environment Variables:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your anon key |

### 3.3 Deploy
- Click "Deploy"
- Wait ~2 minutes for build
- Get your live URL!

---

## Step 4: Post-Deploy (Optional)

### 4.1 Connect Supabase-Vercel Integration
1. Supabase Dashboard → Settings → Integrations
2. Find Vercel → Connect
3. This auto-syncs env vars

### 4.2 Custom Domain (Optional)
1. Vercel → Settings → Domains
2. Add your domain
3. Follow DNS instructions

---

## Development Commands

```bash
# Local development
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Lint code
npm run lint
```

---

## Troubleshooting

### Build Fails
- Check: Node version in Vercel (use Node 18)
- Clear: Vercel project → Deployments → "Redeploy"

### Supabase Connection Error
- Verify env vars are set in Vercel
- Check Supabase project is active (not paused)
- Test URL format: `https://xxxxx.supabase.co` (no trailing slash)

### Database Tables Missing
- Re-run `supabase db push`
- Or paste `supabase-setup.sql` in SQL Editor again

---

## Performance Optimization

### Vercel
- ✅ Already configured with caching headers
- ✅ Using Vite with optimized chunking

### Supabase
- ✅ Indexes already added for fast queries
- ✅ RLS policies for security
- Tip: Enable connection pooling (default in Supabase)

---

## Files Reference

- `supabase-setup.sql` - Database schema
- `vercel.json` - Vercel configuration
- `vite.config.ts` - Build optimization
- `.env.example` - Environment template