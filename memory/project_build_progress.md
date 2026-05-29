---
name: Build progress (Survivor Fantasy app)
description: Current build state — what's fully working vs still to do
metadata:
  type: project
---

The app is functionally complete for running a season. All core admin and player-facing views are built and deployed.

**Why:** Learning project ported from Google Sheet. Built feature by feature.

**How to apply:** Don't suggest re-building things that are already done. Focus on polish, bugs, or new features layered on top.

---

## Completed

- Auth (email/password + Google OAuth), route guards, Pinia auth store
- Admin shell (sidebar nav, admin-only guard)
- Seasons CRUD — full config (bounty pts, swap penalties, grace period, max swaps)
- Season action types — global catalog + per-season enable/disable + point overrides
- Contestants CRUD per season — including bio, age, hometown, occupation fields (added via ALTER TABLE)
- CSV import for contestants — admin can bulk-import a full cast from CSV (name, tribe, photo_url, age, hometown, occupation, bio); inserts into both `contestants` and `contestant_tribe_assignments`
- Episodes — create, start, end, merge/finale flags, bounty result
- Action entry per episode (ActionEntryView) — multi-select contestants + actions, tribe grouping, tribe quick-add
- Global action type catalog (ActionTypesView) — inline edit, bulk delete
- Leaderboard with real-time scoring
- Team creation wizard — **6 steps** (Code → Name → Pick Players carousel → Declare MVP → Bounty → Review). Full Survivor-themed dark UI overhaul. Trading card contestant cards with tribe-colored glowing borders, photo fills, info modal. Step 3 is a full-bleed horizontal carousel with floating scroll buttons (w-60 cards). Step 3 top-right shows circular player avatar slots that fill as contestants are selected.
- New shared components: `ContestantCard.vue`, `ContestantDetailModal.vue`
- New utility: `src/utils/tribeColors.ts` — deterministic tribe → hex color mapping (6-slot palette, hash by char codes)
- Shared type: `src/types/contestant.ts` — `ContestantFull` type used across wizard, TeamView, and card components
- TeamView — roster display, swaps, bounty picks, MVP designation
- Supabase Storage bucket `contestant-photos` — public bucket for player headshots. Season 50 photos follow pattern `50_Name_OG.webp` (spaces → underscores). Exceptions: Colby Donaldson → `50_Colby_Donaldson_OG.webp`, Jenna Lewis → `50_Jenna_Lewis_OG.webp`, Rick Devens → `50_Rick_OG.webp`
- Deployed to Vercel with auto-deploy on push
- Supabase keepalive GitHub Actions cron (Mon + Thu at 9am UTC)
- Google OAuth redirect URLs configured for both localhost and production

## Known gaps / future work

- SettingsView is a stub (registration code/invite link UI exists but may need wiring)
- No automated tests
- Schema.sql may be slightly behind actual Supabase schema (migrations applied manually via SQL editor)
- Figma design file exists (key: `uXcUKpSbFmin4MhMmUFhp9`) but is largely empty — only a cover frame so far
