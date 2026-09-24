---
name: League home dashboard
description: The league home/summary screen — current layout, data sources, and that it's admin-only until released
metadata:
  type: project
---

Sam wanted a league home screen that acts as a summary/dashboard and serves as the app's front door. Built on branch `feature/league-home-dashboard` (started 2026-09-09, layout reworked 2026-09-23/24).

**Why:** Players landed straight on their own team page; Sam wanted a league-wide summary as the first thing they see.

**How to apply:** It lives in `DashboardView.vue` on the `/dashboard` route. It is **admin-only for now** (`requiresAdmin` on the route, `adminOnly` on the Home tab in `AppLayout.vue`, and `/` sends admins to `/dashboard`, everyone else to `/my-team`). Releasing it to players = removing those three gates. See [[project_the_ultimate_survivor_game_fantasy]] and the append-only / client-side-scoring conventions.

---

## Layout (wide screens; stacks to one column below `lg`)

- **Row 1:** Team card (header: avatar, name, owner, place with ordinal, points; body: `PlaceHistoryChart` — place by episode, 1st at top, sand line, dashed green in-the-money line from `seasons.payouts`) · **Season Leaders** (top 6, or top 5 + your row; "N Teams" subtitle; Leaderboard button).
- **Row 2:** **Bounty Breakdown** (header with "Episode N: Name" + Update button → My Team; parchment scroll with the bounty hit's name + votes received; success %; Most Picked top 3 with `episode_votes` counts) · **Most Popular Players** (top 5 most-rostered, split bar of MVP vs player slots scaled to share of teams, legend in header).
- **Row 3:** **Player Scores** — `PlayerScoresTable` heatmap: contestants × completed episodes, pinned Player + Total columns, green/red gain/loss shading, numbers always printed.

Card headers share one style: gray `bg-surface-subtle` bar, `text-lg` bold title, `text-xs` subtitle; header buttons use `headerButtonClass` (RouterLink styled as BaseButton secondary sm).

## Data

- One `computeLeaderboardSnapshots()` fetch (in `useLeaderboard.ts`) returns full-season standings, a snapshot per completed episode, and per-episode contestant points. It shares math with `computeLeaderboard` via `fetchLeaderboardData` + pure `scoreLeaderboard`.
- Episode-capped snapshots only count swap penalties with `effective_from_episode <= N` (fixed 2026-09-24; also corrects the admin Weekly Export's weekly deltas).
- Chart colors are theme tokens validated with the dataviz script: `chart-mvp`/`chart-player` (gold/blue) and `chart-gain`/`chart-loss` (green/red), with separate dark-mode values.
- Dev preview: `/dashboard?mock=1` (DEV only) fills every card from `loadMock()`.
