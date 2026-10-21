---
name: corrections
description: Record a human correction and, when it names a repeated shortcut, propose a constraint. Use when the user corrects the agent.
---

A correction is a process worth keeping. The words stay in the note. A repeated shortcut becomes a constraint.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" correction-add --root . --note "<what the human corrected>" --signature "<slug>"`.
2. Omit `--signature` when the correction is a one-off with no stable shortcut.
3. When the command proposes a constraint, show `.quorum/proposed/<signature>.md`. In team mode the threshold is the number of `team/failures.jsonl` lines for that signature, and the same text is also written to `team/proposed/<signature>.md`. Nothing writes `resolved`. The human applies it.
