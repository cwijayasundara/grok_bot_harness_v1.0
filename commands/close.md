---
description: Release the active quorum job after its trace is ready
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js job-close *)
---

Release the active job. This does not merge.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" job-close --root "${CLAUDE_PROJECT_DIR}"`

When the result says `closed: true`, the job file is marked closed, matching inbox and buffer rows are dropped, and the feature fence is lifted. When it stays closed, read the reason. A red trace is not a wait for the lead. A missing swarm trace, a one-way door without a check, or `one-way door stops for the lead` cannot close. To abandon a job that is not ready, delete `.quorum/active.json` from a terminal outside this session. Abandon does not mark the job closed.
