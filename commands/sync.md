---
description: Project committed slices into this checkout's inbox and buffer
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js note-sync *)
---

Sync this checkout from the slice files already in the worktree.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" note-sync --root "${CLAUDE_PROJECT_DIR}"`

Report the inbox count, the buffer count, and any skipped signatures. An unmet dependency stays in the inbox. Do not retype the slice. Do not confirm inbox rows by hand. Do not merge.
