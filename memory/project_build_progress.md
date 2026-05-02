---
name: Build progress (Survivor Fantasy app)
description: Where Sam is in the build plan — what's done and what's next
type: project
---
**Build plan (high level):**
1. Plan project architecture ✅
2. Set up dev environment (Node, git, GitHub repo) ✅
3. Scaffold Vue 3 + Vite + TS app ✅
4. Deploy first version to Vercel ✅
5. Create Supabase project + run schema.sql (11 tables) ✅
6. Profile auto-create trigger + RLS policies + seed 32 action_types for Survivor 50 ✅
7. Wire Supabase + auth into Vue app:
   - 7a: Install @supabase/supabase-js + .env.local with VITE_SUPABASE_URL/ANON_KEY ✅
   - 7b: Create src/lib/supabase.ts singleton client ✅
   - 7c: Build login page (email/password) ✅
   - 7d: Auth state (Pinia store) + route guards ✅
   - 7e: Add env vars to Vercel ⬅️ CURRENT
8. Build admin shell + Seasons CRUD as first feature
9. Team creation + MVP designation
10. Episode workflow + action entry
11. Scoring view + leaderboard
12. Bounties
13. Swaps with penalties
14. Polish

**Project location:** ~/lucky-5-projects/survivor-fantasy
**Supabase project ref:** ahxxekjyadqlowwbocoi
**GitHub repo:** lucky5sam/the-ultimate-survivor-game (deployed via Vercel auto-deploy)
**Admin user:** sam@cerkl.com (is_admin = true in profiles table)
