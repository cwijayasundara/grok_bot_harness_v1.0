---
description: Append one smell to the quorum buffer, or show how the rows group
disable-model-invocation: true
argument-hint: "add <summary> | assign"
arguments: action summary
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js buffer-add *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js buffer-assign *)
---

The user asked to `$action` the quorum buffer. The rest of the request is `$summary`.

When the action is `add`, run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" buffer-add --root "${CLAUDE_PROJECT_DIR}" --summary "$summary" --signature "<slug>" --source human --confirmed`

Add `--feature "<dir>"` when the slice is not the signature. Add `--door one-way` only when the change cannot be reverted. The default door is `two-way`. Do not pass `--depends-on`, `--snapshot`, `--note`, or `--check`. Those fields are filed by note-sync.

Pick one short signature. The same shortcut uses the same signature later. Do not edit `features/` and do not open a job.

When the action is `assign`, run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" buffer-assign --root "${CLAUDE_PROJECT_DIR}"`

Report the groups. One signature is one job. Do not spawn a worker from this command.
