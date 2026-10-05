---
name: project_spoiler_protection
description: Spoiler Protection feature — how the per-player episode cap works, where it's applied, and the rules any new player-facing data must follow
metadata:
  type: project
---

Built 2026-09-30 → 2026-10-05 (branch `feature/spoiler-protection`). Players who haven't watched the latest episode see the app "frozen" at an earlier episode.

**Why:** Players watching later couldn't open the app without seeing results (scores, who was voted out).

**How it works:**
- Trigger: admin clicks Start on an episode (status `active`). A blocking prompt (`SpoilerPrompt.vue`, blurred backdrop, no close) asks: slide to reveal, or "Keep Spoiler Protection on".
- State: two `profiles` columns, `spoiler_answered_episode_id` and `spoiler_revealed_episode_id` (account-level, cross-device). `stores/spoiler.ts` derives `cap` = last visible episode number, or null for no cap. It applies to the current season only; past seasons are never capped. `refresh()` runs in the router guard before every player page.
- Applying the cap: `utils/spoiler.ts` holds the rules:
  - Results (actions, votes, eliminations, finale winner, tribe changes) are visible if the episode is ≤ cap.
  - Roster, bounty-pick and swap rows are visible if `effective_from_episode` is ≤ cap+1, because they were committed before cap+1 aired.
  - Episodes past the cap read as unfinished.
- `useLeaderboard` takes `visibleThrough` (and `computeTeamBreakdown` takes `cap`) and rewinds the raw rows right after fetching. Each page passes `spoiler.capFor(seasonId)`.
- While capped, swaps and bounty picks are locked on My Team.
- UI: `SpoilerBanner.vue` sits at the top of Dashboard, My Team, Leaderboard and Event Log. It has a blue tint and an orange "I've Watched Episode N" button (the "thaw"). `FireGlow` turns ice-blue automatically while capped. `RouterView` in `AppLayout` is keyed on the cap, so a reveal remounts the page.

**How to apply:** Any NEW player-facing view or query that shows episode-derived data (scores, eliminations, votes, events, tribes, other teams' rosters/picks) must apply `spoiler.capFor(seasonId)` using the `utils/spoiler.ts` helpers. Admin pages are intentionally uncapped. Known gaps:
- the weekly email export isn't capped
- PublicTeamView is capped but shows no banner
- a newly started episode is only caught on navigation

Related: [[project_league_home_dashboard]].
