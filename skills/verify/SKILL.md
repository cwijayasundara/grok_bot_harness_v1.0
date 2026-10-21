---
name: verify
description: Run the product check on the frozen intent snapshot and keep the trace. Use before claiming a job is done. A green lint is not verification.
---

Verification is what makes a loop a loop. The agent runs the check and reads the result. A story about the code is not a trace.

1. The active snapshot already names the check. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" verify --root .`.
2. `"passed": true` means the feature-directory lint is clean and every check that ran exited 0. When `team/check.js` exists, verify refuses a noop body, runs it, then still runs the snapshot check unless that command is exactly `node team/check.js`. The trace records `team_exit` (`null` when the file is absent) and `check_exit`. The plugin does not prove `team/check.js` calls every feature check. Anything else is red. Fix the feature and run it again.
3. Do not rewrite the check so it matches the code. Do not edit `.quorum/`.
4. Do not claim done while the command exits non-zero. The human merges.
