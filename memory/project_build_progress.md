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
- Contestants CRUD per season
- Episodes — create, start, end, merge/finale flags, bounty result
- Action entry per episode (ActionEntryView) — multi-select contestants + actions, tribe grouping, tribe quick-add
- Global action type catalog (ActionTypesView) — inline edit, bulk delete
- Leaderboard with real-time scoring
- Team creation wizard (5 steps)
- TeamView — roster display, swaps, bounty picks, MVP designation
- Deployed to Vercel with auto-deploy on push
- Supabase keepalive GitHub Actions cron (Mon + Thu at 9am UTC)
- Google OAuth redirect URLs configured for both localhost and production

## Known gaps / future work

- SettingsView is a stub (registration code/invite link UI exists but may need wiring)
- No automated tests
- Schema.sql may be slightly behind actual Supabase schema (migrations applied manually via SQL editor)
