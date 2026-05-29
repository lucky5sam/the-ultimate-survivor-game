---
name: feedback-ui-testing-and-layout
description: Sam prefers to test UI manually; full-page flows should fill the viewport not be constrained in a small container
metadata:
  type: feedback
---

**Rule 1: Don't run Playwright or automated browser actions for UI testing — Sam tests manually.**

**Why:** Sam explicitly declined Playwright UI testing and asked whether it has any value. He prefers to look at the running app himself.

**How to apply:** After making UI changes, point Sam to localhost:5173 and describe what to check. Don't offer to run Playwright or take automated screenshots of the live app to verify UI correctness.

---

**Rule 2: Full-page wizard and multi-step flows must fill the entire viewport — don't constrain them in a centered max-width container.**

**Why:** The TeamCreateWizard was originally inside a `max-w-3xl` container and Sam flagged it as feeling too small. The fix was restructuring TeamView so the wizard renders as a full-page sibling outside any constrained div.

**How to apply:** When building multi-step flows, forms, or wizards, render them at `min-h-screen` filling the full width. Reserve `max-w-*` containers for content-dense views like team management or leaderboards, not interactive flows.
