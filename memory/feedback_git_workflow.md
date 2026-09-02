---
name: feedback-git-workflow
description: Default to feature branch + PR instead of pushing to main; direct-to-main allowed only for genuine quick hotfixes
metadata:
  type: feedback
---

**Rule: Default to feature branches + pull requests. Do not push directly to `main` for normal feature work.**

**Why:** The app now has live/active teams and real players, so Sam wants changes isolated on a branch and reviewed via a PR before they reach production (Vercel auto-deploys `main`). He deliberately did NOT want to hard-block direct pushes to `main` (no server-side branch protection) so a fast hotfix path stays open.

**How to apply:**
- For normal work, create a branch (`feature/<slug>` for features, `fix/<slug>` for bug fixes), commit there, push it, and open a PR with `gh pr create` — then hand Sam the PR link. Do NOT merge automatically; Sam reviews and merges.
- When Sam says "commit and push" for ongoing work, interpret it as branch + push + open PR, not push to `main` — unless he says otherwise.
- Direct-to-`main` is reserved for genuine quick hotfixes, and only when Sam explicitly asks for a hotfix / to push straight to main. When in doubt, ask.

See [[project-build-progress]] for what's shipped.
