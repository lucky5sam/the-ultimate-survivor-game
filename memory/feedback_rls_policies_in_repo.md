---
name: feedback_rls_policies_in_repo
description: RLS policies are tracked in db/policies.sql as the source of truth; mirror any Supabase policy change there
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 941a51e7-34b8-456b-b627-9c85cc1206a3
  modified: 2026-09-02T20:02:43.094Z
---

RLS policies for the app now live in `db/policies.sql` as the git source of truth (added Sept 2026 during a security review). Before that, policies existed only in the Supabase dashboard.

**Why:** Two wide-open `using (true)` SELECT policies on `profiles` had leaked payment info (payment_method/handle/note) to any logged-in user — they went unnoticed for a long time precisely because nothing in the repo was reviewable. A friend reported enumerating the user list via the API.

**How to apply:** When you add or change a policy in the Supabase SQL editor, mirror it in `db/policies.sql` in the same PR. The file is idempotent (drops-by-name then recreates) and doubles as a reconcile script. Admin checks are normalized to the `is_admin()` SECURITY DEFINER helper. Names are read via the `public_profiles` view (id/first_name/last_name/avatar_url only); the base `profiles` table is self + admin read only. Privilege escalation on `is_admin` is blocked by the `profiles_no_self_admin` trigger. `db/schema.sql` was rebuilt from the live DB during the same review (it had drifted badly); it's accurate for columns/types/keys but omits ON DELETE rules, CHECK constraints, triggers, and functions — for a byte-exact copy use `supabase db dump --schema public`. See [[feedback_git_workflow]].
