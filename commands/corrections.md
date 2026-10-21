---
description: Record a human correction against a shortcut
disable-model-invocation: true
argument-hint: "<signature> <note>"
arguments: signature note
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js correction-add *)
---

Record the correction. The signature is `$signature`. The note is `$note`.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" correction-add --root "${CLAUDE_PROJECT_DIR}" --signature "$signature" --note "$note"`

If the result says `proposed`, show the proposal file. Do not apply it yourself.
