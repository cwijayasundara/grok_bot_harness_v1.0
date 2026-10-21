---
name: sample
description: Sample the buffer and landed work instead of reviewing every line. Use for morning review. Does not raise trust and does not merge.
---

Sampling is a review of some landed work, not a review of every line. It does not raise trust and it does not merge.

1. Read `.quorum/trust.json`, `.quorum/buffer.md`, `.quorum/buffer.json`, and `.quorum/failures.json`. When the checkout has them, also read `team/landed.json`, `team/proposed/`, and `team/failures.jsonl`. A trust rung of `sampling` means the same shortcut has already repeated. Merge stays `human`. A red trace is not a wait for the lead. A one-way team job stays blocked until `team/acks/<snapshot>.json` is in the worktree.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" buffer-assign --root .`. Several rows with one signature are one shortcut, not one job per row.
3. A repeated signature goes to the constrain skill. A one-off stays a one-off.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" merge-status --root .` before telling the human a job is ready. A one-way door without a reversible check is refused. A missing or red trace is refused.
5. Record what you sampled with `node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" sample-note --root . --note "..."`. The human merges, reverts, or applies the proposed rule. Nothing here sets an unattended merge.
