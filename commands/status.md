---
description: Show the quorum buffer, the active job, and the latest verify trace
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js status *)
---

Quorum status for this repository:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" status --root "${CLAUDE_PROJECT_DIR}"`

The lines include `blocked` and `landed`. When a job is active, the next line is `merge:` and the merge-status reason. `engineer` is printed when `.quorum/engineer.json` exists. This status does not print claims. The lead reads `team/claims.json`.

Repeat that status. Do not edit files and do not merge.
