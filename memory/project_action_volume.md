---
name: project_action_volume
description: "A season has at most ~450 contestant_actions rows, so Supabase's 1,000-row response cap isn't a concern for the leaderboard fetch"
metadata:
  node_type: memory
  type: project
  originSessionId: 251c77cf-3f9f-4edd-b680-7efaa830312a
  modified: 2026-10-01T01:46:14.764Z
---

Sam confirmed (2026-09-30) that past seasons topped out around **450 `contestant_actions` rows per season**. The leaderboard's `fetchLeaderboardData` loads one season's actions without `.range()` paging, which would silently truncate past Supabase's 1,000-row default cap — but at this volume it never gets close.

**Why:** Paging was flagged as a pre-launch risk for releasing League Home; Sam decided it's unnecessary given real volumes.

**How to apply:** Don't re-raise the 1,000-row cap for per-season `contestant_actions` fetches. Only revisit if logging gets much more granular or a query spans multiple seasons. Related: [[project_league_home_dashboard]].
