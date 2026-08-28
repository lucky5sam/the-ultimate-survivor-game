---
name: feedback_image_shape_convention
description: Image shape rules — team photos are square with proportional rounded corners; user avatars are circular
metadata:
  type: feedback
---

Team profile images must always be a **square** presentation with **rounded corners**, in every context (My Team header, leaderboard thumbnail, wizard/edit pickers, crop guide). User account avatars are **circular**.

Corner radius for team images is **proportional to size**, not a single fixed value: ~16px (`rounded-2xl`) on large images (e.g. the 64px My Team header), ~8px (`rounded-lg`) on small thumbnails (e.g. the 32px leaderboard row). The user explicitly chose proportional over one fixed radius.

**Why:** Keeps a consistent visual identity — team = rounded square, user = circle — while a fixed 16px on a 32px thumbnail would look like a near-circle squircle.

**How to apply:** When adding any new team-image render site (e.g. the public team page), use a square container with `object-cover` and a size-appropriate rounded corner. Use `ImageUploadField`/`ImageCropModal` with `shape="square"` for team-image inputs and `shape="circle"` for avatars. See [[project_build_progress]].
