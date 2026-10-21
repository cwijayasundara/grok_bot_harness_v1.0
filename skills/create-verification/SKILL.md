---
name: create-verification
description: Add the check a feature runs, and a short note of how to run it. Use when a feature has no check. The check must fail when the feature is wrong.
---

Each feature carries the means to run it.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" check-init --root . --feature "<feature>"`.
2. Read `features/<feature>/VERIFY.md`. Replace the generated `features/<feature>/check.js` with a check that fails on the broken feature and passes on the fixed one.
3. Open the snapshot with `--check "node features/<feature>/check.js"`. After that, the check file is frozen for the job.
4. Do not use a command that exits 0 without running the feature.
