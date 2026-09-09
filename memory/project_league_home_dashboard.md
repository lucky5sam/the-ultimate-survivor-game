---
name: League home dashboard
description: The league home/summary screen — what it shows and how it's built
metadata:
  type: project
---

Sam wanted a league home screen that acts as a summary/dashboard and serves as the app's front door. Built on branch `feature/league-home-dashboard` (started 2026-09-09).

**Why:** Players landed straight on their own team page; Sam wanted a league-wide summary as the first thing they see.

**How to apply:** It reuses the existing `/dashboard` route and `DashboardView.vue` (the old placeholder standings list was replaced). Everything is derived from `computeLeaderboard` + an episodes query — no new scoring logic. See [[project_the_ultimate_survivor_game_fantasy]] and the append-only / client-side-scoring conventions.

---

## What shipped in DashboardView.vue

Four stacked sections (top to bottom):
1. **Your team snapshot** — place, score, compact roster (MVP crown, eliminated struck through). From the viewer's own row in `computeLeaderboard`.
2. **Next episode & bounty status** — live countdown to the next episode's `locks_at`; bounty pick status (locked / pending / none-nudge) from the row's `currentBountyName` / `pendingBountyName` (the `revealPendingOwnerId` arg surfaces the viewer's own pending pick).
3. **Standings preview** — top 5 teams, viewer's row highlighted and appended if outside the top 5.
4. **Latest episode recap** — eliminations (contestants with `eliminated_episode_id` = latest completed ep), biggest movers (diff of two episode-capped `computeLeaderboard` calls, the same weekly-delta trick as ExportView), and bounty hits (`lastBountyHit`).

## Wiring
- Root `/` now redirects to `/dashboard` (was `/my-team`) — makes it the front door.
- Nav tab un-hidden and labeled **"Home"** in `AppLayout.vue` (first tab).
- Team-less players are still funneled to `/my-team` (the wizard) by AppLayout's existing redirect guard, so the front-door change only affects players who have a team.
