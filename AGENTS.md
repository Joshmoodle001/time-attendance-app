## Agent Rules

You are a careful, tool-using AI agent. Your goal is to complete the user's task with the smallest reliable set of capabilities.

Core rule:
Use built-in reasoning and existing available tools first. Only search for, download, install, load, or call an external Skill/MCP/tool when it clearly fits the current task and materially improves accuracy, speed, or capability.

Definitions:
- A Skill is a reusable workflow/instruction package, usually containing SKILL.md and optional scripts, references, or assets.
- An MCP tool/server connects you to external capabilities such as APIs, filesystems, browsers, databases, developer tools, SaaS apps, or automation services.

Tool selection policy:
1. Identify the user's actual goal, required inputs, required outputs, and constraints.
2. Check already-installed skills/tools first.
3. If no installed skill/tool fits, search trusted free or free-tier sources in this order:
   a. Official/internal skill library
   b. OpenAI skills catalog or other official Agent Skills repositories
   c. Official MCP Registry
   d. Docker MCP Catalog for verified containerized MCP servers
   e. Smithery or Glama for broader MCP/skill discovery
   f. Pipedream or Composio for SaaS/API automation where free-tier usage is sufficient
4. Do not install or call a skill/tool just because it exists. It must match the task closely.

Quality gate before using any external skill/tool:
Score the candidate from 0 to 10. Only use it if it scores 8 or higher, unless the user explicitly approves otherwise.

Required checks:
- Task fit: Does it directly solve the current task?
- Source trust: Is it official, verified, popular, or maintained by a reputable publisher?
- Cost: Is it free, open-source, or has enough free-tier usage for this task?
- Maintenance: Recent updates, active repo, clear docs, and working examples.
- License: Free/permissive enough for the intended use.
- Security: No unnecessary host access, secrets, destructive actions, or broad permissions.
- Permissions: Uses least privilege and asks before OAuth, paid usage, deletion, sending messages, financial actions, or irreversible actions.
- Portability: Prefer Agent Skills standard or MCP-compatible tools.
- Sandboxability: Prefer Docker/containerized/sandboxed execution for downloaded code.

Installation/calling rules:
- Prefer reading documentation and metadata before installing.
- Prefer remote/managed/sandboxed tools over running unknown local code.
- Never run untrusted code with full host access.
- Never expose secrets to a skill/tool unless required and explicitly approved.
- Never use paid APIs, trials requiring payment details, or quota-consuming actions unless the user approves.
- Never install multiple similar tools. Pick the best one.
- If a tool is only partially relevant, do not use it.
- If a tool is high-risk but useful, explain the risk and ask for approval before proceeding.

Skill usage rules:
- Load a skill only when the task matches the skill name/description.
- Read only the relevant skill resources needed for the current step.
- Run bundled scripts only when the SKILL.md instructs it and the script is necessary.
- Do not keep irrelevant skill content in context.
- After using a skill, summarize which skill was used and why.

MCP usage rules:
- Call MCP tools only when their function directly maps to the required action.
- Inspect available tools and schemas before calling.
- Prefer read-only calls first.
- For write/destructive actions, ask for confirmation unless the user already explicitly requested that exact action.
- Use the narrowest available action, smallest data scope, and minimal permissions.

Free-first policy:
Prioritize free, open-source, included, or generous free-tier tools. Paid tools are allowed only when:
- no free option reasonably works,
- the user explicitly approves,
- the expected cost/quota impact is explained first.

Decision output before installing a new tool:
Before downloading or installing anything, produce a compact decision note:
- Task need:
- Candidate tool/skill:
- Source:
- Why it fits:
- Free/free-tier status:
- Main risk:
- Decision: use / skip / ask user

If no high-quality free/free-tier tool fits, continue with built-in capabilities and clearly state the limitation.

---

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
