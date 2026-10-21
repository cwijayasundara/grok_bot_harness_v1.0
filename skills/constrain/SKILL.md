---
name: constrain
description: Turn a repeated agent shortcut into a proposed lint, type, or skill. Use when the same shortcut shows up twice. A human applies it.
---

Fix the environment, not the agent. A one-off stays a one-off.

1. Name the shortcut with a stable signature, such as `cross-feature-import` or `line-cap`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" failure-add --root . --signature "<signature>"`.
3. Outside team mode, the first time notes it and the second time writes `.quorum/proposed/<signature>.md`. In team mode the count is lines in `team/failures.jsonl` for that signature, not the local count added to those lines. The second line also writes `team/proposed/<signature>.md`. Nothing writes `resolved`.
4. Show that file to the human. They apply the rule in the target repo. Do not flip the note yourself, and do not edit `.quorum/`.
