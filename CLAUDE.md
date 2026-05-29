@memory/MEMORY.md

# The Ultimate Survivor Game

Survivor fantasy league web app. ~72 players draft teams of 4 Survivor contestants and score points based on in-game actions, bounty picks, and swaps. Admin enters everything manually after each episode airs.

## Commands

```bash
npm run dev          # start dev server (localhost:5173)
npm run build        # type-check + build for production
npm run type-check   # TypeScript check only
npm run lint         # oxlint + eslint with auto-fix
npm run format       # prettier format src/
```

## Stack

Vue 3 + TypeScript + Tailwind 4 + Pinia + Vue Router + Supabase + Vite. Deployed on Vercel (auto-deploy on push to `main`).

## Key Conventions

- **Append-only versioning:** `team_players`, `bounty_picks`, and `contestant_tribe_assignments` are never updated — swaps and changes are new inserts with `effective_from_episode` / `effective_to_episode`. Never break this pattern.
- **Scoring is client-side:** Leaderboard computes scores in the browser from raw Supabase data. There is no server-side scoring function.
- **Admin enters everything:** No player-facing data entry beyond team creation, swaps, and bounty picks.
- **RLS is on:** All Supabase queries run through the authenticated user. Admin-only operations are gated by `is_admin = true` in `profiles`.

## Things to Avoid

- Don't add automated tests — there are none and the user hasn't asked for them.
- Don't suggest premature abstractions or shared composables unless there's clear duplication.
- Don't modify the append-only versioning pattern — it preserves scoring history.
- Don't add schema migrations without confirming — schema changes are applied manually via the Supabase SQL editor.
