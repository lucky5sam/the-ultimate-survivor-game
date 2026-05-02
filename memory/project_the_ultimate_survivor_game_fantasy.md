---
name: Survivor Fantasy Game web app
description: The Survivor 50 fantasy game project — rules, stack, and design decisions agreed in planning
type: project
---
Sam is porting his Survivor Fantasy Game from a Google Sheet to a web app. ~72 players will have accounts.

**Stack:** Vue 3 + Vite + TypeScript + Tailwind + Pinia, Supabase (Postgres + Auth + RLS), Vercel hosting. Goal: cheap/free to host. Learning project.

**Game rules (Survivor 50):**
- Each player drafts a team of 4 contestants; 1 designated MVP (1.5x score multiplier).
- Each episode, players pick a "Bounty" — a contestant they think will be eliminated next. Worth 5 pts pre-merge, 10 pts post-merge (configurable per season; admin sets merge episode).
- Roster swap penalties: -15 MVP, -10 regular player. Free during grace period (through episode 1).
- Eliminated teammates stay on roster scoring 0 until swapped; points earned before swap are kept by the team.
- Rosters lock at season start (no mid-season joiners).
- Admin enters all episode data manually via an admin portal.

**Key design decisions:**
- `team_players` is append-only and versioned by episode range (effective_from_episode, effective_to_episode) so swaps are inserts, not updates — preserves scoring history.
- `contestant_tribe_assignments` uses the same versioned pattern (Survivor has tribe swaps + merge mid-season).
- Pre/post-merge scoring variants (e.g. "Successful Vote" vs "Successful Vote +") are kept as separate `action_types` rows; admin picks the right one.
- 32 scoring categories sourced from his CSV across types: Advantages, Challenges, Milestone, Penalties, Voting, Misc.

**Why:** Learning project, not commercial. Decisions favor clarity and future-proofing over cleverness.
**How to apply:** When suggesting features or schema changes, preserve the append-only versioning pattern and the admin-enters-everything model.
