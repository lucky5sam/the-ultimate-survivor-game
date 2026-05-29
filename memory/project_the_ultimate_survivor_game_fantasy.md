---
name: Survivor Fantasy Game web app
description: Full context for the Survivor fantasy league app — stack, schema, game rules, file structure, and design constraints
metadata:
  type: project
---

Sam is porting his Survivor Fantasy Game from a Google Sheet to a web app. ~72 players have accounts.

**Why:** Learning project, not commercial. Decisions favor clarity and future-proofing over cleverness.

**How to apply:** When suggesting features or schema changes, preserve the append-only versioning pattern and the admin-enters-everything model. Don't suggest premature abstractions.

---

## Stack

- **Frontend:** Vue 3 (Composition API) + Vite + TypeScript + Tailwind 4 + Pinia + Vue Router
- **Backend/DB:** Supabase (managed Postgres + Auth + RLS)
- **Hosting:** Vercel (auto-deploy on push to main)
- **Auth:** Supabase Auth — email/password + Google OAuth
- **Supabase project:** `ahxxekjyadqlowwbocoi.supabase.co`
- **Deployed at:** `https://the-ultimate-survivor-game.vercel.app`
- **GitHub repo:** `lucky5sam/the-ultimate-survivor-game`
- **Admin user:** sam@cerkl.com (`is_admin = true` in profiles)

---

## Game Rules

- Each player drafts a team of 4 Survivor contestants; 1 designated MVP (1.5× score multiplier), 3 regular (1×)
- **Scoring = Action Points + Bounty Points − Swap Penalties**
- **Action Points:** Contestants earn points from ~32 global action types (e.g. "Won Immunity" = +5). Admin enters actions per episode manually.
- **Bounty:** Each week teams pick which contestant they think gets eliminated. Correct = 5 pts pre-merge / 10 pts post-merge / 15 pts finale (all configurable per season)
- **Swap Penalties:** After grace period (default: through Ep 1), swapping costs −15 (MVP), −10 (player), −5 (role change). Configurable per season.
- Eliminated contestants stay on roster scoring 0 until swapped; points earned before elimination are kept
- Rosters lock at season start (no mid-season joiners)
- Max swaps configurable per season (null = unlimited)

---

## Database Schema (13 tables)

| Table | Purpose |
|-------|---------|
| `profiles` | Users — `is_admin`, `first_name`, `last_name` (FK to auth.users) |
| `seasons` | Season config — `status` (upcoming/active/completed), `bounty_points_pre_merge`, `bounty_points_post_merge`, `bounty_points_finale`, `swap_penalty_mvp`, `swap_penalty_player`, `swap_penalty_role_change`, `grace_period_through_episode`, `max_swaps`, `current_episode_id`, `merge_episode_id` |
| `contestants` | Season FK, `name`, `photo_url`, `eliminated_episode_id` |
| `episodes` | Season FK, `number`, `title`, `air_date`, `status`, `is_merge`, `is_finale`, `bounty_contestant_id` |
| `contestant_tribe_assignments` | Versioned tribe assignments — `effective_from_episode`, `effective_to_episode` |
| `action_types` | Global catalog (~32 types) — `type`, `category`, `points`, `sort_order`. No season_id. |
| `season_action_types` | Join table — enables action types per season with optional point overrides and sort_order |
| `teams` | User FK, season FK, `team_name` |
| `team_players` | **Append-only versioned roster** — `role` (mvp/player), `effective_from_episode`, `effective_to_episode` |
| `contestant_actions` | Per-episode action log — `episode_id`, `contestant_id`, `action_type_id`, `count`, `note` |
| `bounty_picks` | Versioned bounty selections per team — `effective_from_episode` |
| `team_swaps` | Swap history with `penalty_points` |
| `transactions` | Audit log for point adjustments |

**Key design decision:** `team_players`, `bounty_picks`, and `contestant_tribe_assignments` are all append-only, versioned by `(effective_from_episode, effective_to_episode)`. Swaps are inserts, not updates — preserves scoring history across the season.

---

## File Structure

```
src/
  views/
    TeamView.vue              — player-facing: roster display, swaps, bounty picks
    LeaderboardView.vue       — real-time scoring across all teams
    LoginView.vue             — email/password + Google OAuth
    ResetPasswordView.vue
    admin/
      AdminLayout.vue         — sidebar nav shell (dark theme)
      SeasonsView.vue         — season config + action type enable/override per season
      ContestantsView.vue     — add/edit contestants per season
      EpisodesView.vue        — create episodes, set merge/finale flags, start/end episodes
      ActionEntryView.vue     — per-episode contestant action entry (most complex view)
      ActionTypesView.vue     — global action type catalog management
      SettingsView.vue        — registration code + invite link
  stores/
    auth.ts                   — Pinia auth store; `ready` flag gates router navigation (one-way: false→true only during init)
  router/index.ts             — all routes; requiresAuth + requiresAdmin guards
  lib/supabase.ts             — Supabase singleton client
  components/
    TeamCreateWizard.vue      — 5-step team creation flow
    ToastContainer.vue
  composables/
    useToast.ts
```

---

## Admin Workflow

1. Create season (configure bounty pts, swap penalties, grace period)
2. Add contestants for that season
3. Configure which action types are enabled + point overrides (via season_action_types)
4. Create episodes; mark merge/finale; set bounty result contestant
5. Per episode: enter contestant actions via ActionEntryView (select contestants + actions + count)
6. Scores compute client-side in LeaderboardView from raw data

---

## Infrastructure

- **Supabase keepalive:** GitHub Actions workflow (`.github/workflows/keepalive.yml`) pings `action_types?select=id&limit=1` every Monday and Thursday at 9am UTC to prevent free-tier project pause
- **Secrets:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` stored as GitHub repo secrets
