---
description: Open one quorum job for a feature, with a door and a frozen intent
disable-model-invocation: true
argument-hint: "<feature> <two-way|one-way> <intent>"
arguments: feature door intent
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js job-open *)
---

Open one quorum job in this repository. The user supplied feature `$feature`, door `$door`, and intent `$intent`.

If `features/$feature/check.js` does not exist, stop. Tell the user to run `/quorum:check $feature` and replace the stub so it fails when the feature is wrong. Do not open the job with an empty check.

When the user supplied a slice path, run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" job-open --root "${CLAUDE_PROJECT_DIR}" --from "<notes/note/feature.md>"`

Do not pass `--intent` in that case. The slice body is the intent. Pass `--feature` or `--door` only when they equal the slice.

Otherwise, when that file exists, run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" job-open --root "${CLAUDE_PROJECT_DIR}" --feature "$feature" --door "$door" --intent "$intent" --check "node features/$feature/check.js"`

A one-way door uses the same check. The check has to exercise the feature. Do not edit the feature in this command. Do not merge.
