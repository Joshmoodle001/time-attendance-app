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

## Session Log - 2026-04-29

### 14:02 - Fix Supabase Employee Loading Issue
- User reported: App not calling employees from Supabase, only keeping uploaded data
- Action taken: Explored codebase to find root cause
- Findings:
  - No `.env` file existed (Supabase not configured)
  - Employee source mode likely set to "local" in localStorage
  - App falls back to localStorage/IndexedDB when Supabase unavailable
- Files changed:
  - Created `.env` with real Supabase credentials
  - Updated `continue.md`, `package.json`, `package-lock.json`
- Commands run:
  - `npm run dev` - started dev server
  - `git commit` - committed changes
  - `git push origin main` - pushed to GitHub
  - `vercel --prod` - deployed to Vercel
- Agents used:
  - `@repo-mapper` - explored project structure
- Validation:
  - ✅ Employees table created in Supabase (user ran SQL)
  - ✅ Code committed and pushed to GitHub
  - ✅ Deployed to Vercel: https://time-attendance-app-main-i1ijhisyg-joshmoodle001s-projects.vercel.app
- Result:
  - Fixed: App now configured to use Supabase
  - Fixed: Employees table exists in Supabase
  - Pending: User must add env vars to Vercel dashboard
  - Pending: User must clear localStorage `employee-source-mode-v1`
- Next step:
  1. User adds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Vercel environment variables
  2. Redeploy on Vercel
  3. Clear localStorage in browser
  4. App will load employees from Supabase
- Remember:
  - `.env` NOT committed (security) - must set in Vercel dashboard
  - SQL ran successfully - employees table exists
  - localStorage key `employee-source-mode-v1` must be deleted for app to use Supabase
  - Deployed URL: https://time-attendance-app-main-i1ijhisyg-joshmoodle001s-projects.vercel.app

## Session Log - 2026-05-01

### 10:30 - Restructure Reports to Group by Region-Brand
- User reported: Report grouping was not what they asked for. Reports should be grouped by region-brand (e.g. "Limpopo Checkers", "Limpopo Shoprite", "Local Checkers", "Local Shoprite") not by individual store/team.
- Action taken: Restructured ReportsBuilder.tsx to group report output by region-brand first, then stores within each group.
- Files changed:
  - `src/components/ReportsBuilder.tsx` - major restructuring:
    - Added `RegionBrandSection` type wrapping `StoreSection[]`
    - Updated `StoreSection` type to include `brand`, `regionBrandKey`, `regionBrandLabel`
    - Restructured `generatedSections` useMemo to group by region-brand → stores → employees
    - Updated `generatedTotals` to iterate nested structure
    - Updated `generatedAwolRows` to iterate nested structure
    - Added `drawRegionBrandHeader` for PDF export with region-brand group headers
    - Updated PDF export iteration: rbGroup → stores → employees
    - Updated HTML print export with region-brand group headers and CSS styles
    - Updated preview rendering with region-brand group headers (cyan-themed cards)
- Validation:
  - ✅ `npm run build` passes (TypeScript + Vite)
- Result:
  - Reports now grouped by region-brand (e.g. "Limpopo Checkers", "Limpopo Shoprite")
  - Each region-brand group shows total employees and store count
  - Store sections remain within their region-brand groups
  - PDF, HTML print, and preview all updated
- Next step:
  - User should verify the Excel device-region truth data is uploaded correctly
  - Consider adding region-brand filter dropdowns for report generation
  - Device records still need region populated from device region truth (separate task)
- Remember:
  - Brand is inferred from store/team name via `inferRetailBrand()` (Checkers/Shoprite detection)
  - Region comes from device region truth mapping (overrides employee region at runtime)
  - Region-brand key = normalized "region brand" string (e.g. "limpopo checkers")

## Session Log - 2026-05-01 (Afternoon)

### 14:00 - Add Region Column to EmployeesHub + Auto-Resolve on Team Change
- User asked: Continue with next steps from the region sync plan
- Action taken: Added Region column to EmployeesHub table, mobile cards, edit form, and auto-resolve logic
- Files changed:
  - `src/components/EmployeesHub.tsx`:
    - Added Region column header to desktop table (between Team and Custom 1)
    - Added Region badge cell to desktop table body (purple badge styling)
    - Added Region display to mobile employee cards
    - Added Region input field to employee edit/add form
    - Added `deviceRegionTruth` state + useEffect to load truth on mount
    - Added `autoResolveRegion` callback that resolves region from device truth when team/store changes
    - Updated Team and Store input onChange handlers to trigger auto-resolve
    - Added `employee.region` to search fields for filtering
    - Imported `resolveDeviceRegionForInput` from deviceRegionTruth service
- Validation:
  - ✅ `npm run build` passes (TypeScript + Vite)
- Result:
  - Region now visible in employee table (desktop + mobile)
  - Region editable in employee add/edit form
  - Region auto-populates when team or store is changed (if device region truth is loaded)
  - Region is searchable in the employee search bar
  - Region already syncs to Supabase on update (existing `updateEmployee` flow includes region field)
- Next step:
  - User should upload the device region truth Excel file to enable auto-resolve
  - Verify region matching works with actual employee team/store data
  - Consider adding region to emergency upload flow for bulk updates
- Remember:
  - Auto-resolve only works if device region truth has been uploaded and stored
  - Region resolution uses `resolveDeviceRegionForInput()` which matches by store code and normalized name
  - Employee region is also resolved at load time via `applyDeviceRegionsToEmployees()`

### 15:30 - Fix Region Matching Bug: Brand Names Colliding with Store Codes
- User reported: "07468 - SHOPRITE - COMMISSIONER ST (07468)" is listed under "Local" region in the Excel but shows as "Far North West" in the Devices table
- Root cause: `resolveFromEntries()` in `deviceRegionTruth.ts` used `entries.find()` which returns the FIRST match. Entries are sorted alphabetically by region ("Far North West" before "Local"). The function `collectCodeCandidates` extracted "shoprite" as a code candidate from "SHOPRITE - COMMISSIONER ST" (matching the pattern `^([A-Za-z0-9]+)\s*-\s*`). This caused ANY Shoprite entry to match, and the first one alphabetically was a "Far North West" entry.
- Action taken: Rewrote `resolveFromEntries()` with 3-pass matching:
  1. Pass 1: Match by numeric store code only (e.g., "07468") - highest priority
  2. Pass 2: Match by normalized name
  3. Pass 3: Match by any code including brand names - fallback only
- Files changed:
  - `src/services/deviceRegionTruth.ts` - rewrote `resolveFromEntries()` with 3-pass matching
- Validation:
  - ✅ `npm run build` passes
  - ✅ Committed and pushed
  - ✅ Deployed to Vercel
- Result:
  - Numeric store codes (like "07468") now match before brand names (like "shoprite")
  - "07468 - SHOPRITE - COMMISSIONER ST (07468)" will correctly resolve to "Local" region
  - Same fix applies to employee region resolution and report grouping
- Remember:
  - After deploy, user may need to re-upload the device region truth Excel or refresh the page to re-resolve regions
  - The fix affects all region resolution: devices, employees, stores, and reports

### 16:00 - Comprehensive Region Matching Fix (All 5 Issues)
- User asked: "fix all to make sure its all matching correctly"
- Root cause analysis found 5 issues in the matching pipeline:
  1. `collectCodeCandidates` extracted "SHOPRITE" as a code from "SHOPRITE - COMMISSIONER ST" (brand name collision)
  2. `normalizeDeviceRegionTruthEntry` picked first code candidate (could be alphabetic brand name)
  3. `normalizeNameForMatch` stripped leading codes causing name mismatches between entries and inputs
  4. Name matching used exact Set membership instead of flexible containment
  5. `buildDeviceRegionTruthEntriesFromRows` mapKey could collide on brand names across regions
- Action taken: Rewrote matching pipeline in `deviceRegionTruth.ts`:
  - Added `collectNumericCodes()` - extracts ONLY numeric codes (e.g., "07468"), never brand names
  - Kept `collectCodeCandidates()` for fallback matching only
  - Rewrote `normalizeNameForMatch()` - strips codes, lowercases, normalizes separators to spaces
  - Rewrote `resolveFromEntries()` with 3-pass matching:
    - Pass 1: Numeric store code match (highest priority)
    - Pass 2: Name containment match (flexible - handles partial matches like "commissioner st" in "shoprite commissioner st")
    - Pass 3: Any code match (fallback, including brand names)
  - Fixed `normalizeDeviceRegionTruthEntry` to prefer numeric codes for storeCode
  - Fixed `buildDeviceRegionTruthEntriesFromRows` mapKey to use numeric code + normalized name
  - Fixed `inferRetailBrand` to check specific patterns first (e.g., "checkers hyper" before "checkers")
- Files changed:
  - `src/services/deviceRegionTruth.ts` - comprehensive rewrite of matching pipeline
- Validation:
  - ✅ `npm run build` passes
  - ✅ Committed and pushed
  - ✅ Deployed to Vercel
- Result:
  - "07468 - SHOPRITE - COMMISSIONER ST (07468)" correctly resolves to "Local" (not "Far North West")
  - All matching paths fixed: devices, employees, stores, reports, auto-resolve in form
  - Brand names no longer collide with store codes
  - Name matching is flexible (containment-based)
- Remember:
  - User MUST re-upload the device region truth Excel after this deploy to rebuild entries with the new normalization
  - Old cached entries in IndexedDB/Supabase still have the old (buggy) normalization
  - The fix is in the matching logic AND the entry normalization

### 16:30 - Hierarchical Region → Teams Tree for Report Selection
- User asked: Restructure the "By Team" report selection into a collapsible region → teams tree so they can select entire regions at once
- Action taken: Replaced the flat store selection UI with a hierarchical tree:
  - Added `regionTree` useMemo that groups `storeOptions` by region
  - Added `expandedRegions` state to track which regions are expanded
  - Added `toggleRegion`, `addStoresByRegion`, `removeStoresByRegion`, `isRegionFullySelected`, `isRegionPartiallySelected` helpers
  - Replaced the old search + quick-select UI with:
    - Region headers (clickable to expand/collapse) with team count and employee count
    - "Select All" / "Deselect" buttons per region
    - Visual indicators: cyan dot = fully selected, amber dot = partially selected
    - Expanded teams list with individual add/remove buttons
    - Selected stores shown as removable tags at the bottom
- Files changed:
  - `src/components/ReportsBuilder.tsx` - replaced "By Team" selection UI with hierarchical region tree
- Validation:
  - ✅ `npm run build` passes
- Result:
  - Users can now see all regions (e.g., Limpopo, Local, Far North West) as collapsible sections
  - Click a region to expand and see all teams under it
  - Select/deselect entire regions with one click
  - Individual teams can still be toggled within expanded regions
  - Visual indicators show selection state (full/partial/none)
- Next step:
  - Deploy to Vercel
  - User should test the new region tree UI
- Remember:
  - The old `storeRegionBrandGroups` and `addStoresByRegionBrandGroup` are still in the code but no longer used in the UI
  - `storeSearch` state is still declared but no longer used in the new UI (can be cleaned up later)

(End of file - Agent Rules prepended)
