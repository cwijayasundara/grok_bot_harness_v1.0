---
description: Create the verification check for one feature
disable-model-invocation: true
argument-hint: "<feature>"
arguments: feature
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js check-init *)
---

Create the check for feature `$feature`.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" check-init --root "${CLAUDE_PROJECT_DIR}" --feature "$feature"`

Show `features/$feature/VERIFY.md`. Do not merge.
