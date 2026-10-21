# Quorum target

This directory is the codebase. Quorum is a Claude Code plugin. Start the coordinator as the main thread from this directory:

```bash
claude --plugin-dir /Users/chamindawijayasundara/Documents/learning_102/grok_bot_harness_v1.0 --agent quorum:coordinator
```

The one prompt is: `Work the confirmed buffer.`

That session dispatches one confirmed signature, then stops with a verdict. It does not merge.

When `merge-status` says the job is ready, run `/quorum:close`, then merge. Close releases the feature fence. It does not merge.

A session started without `--agent quorum:coordinator` should stop. Relaunch with the command above. Do not dispatch a worker from this file.

For alpha, the check is `node features/alpha/check.js`. Do not edit `.quorum/`.

When this checkout has `team/kitchen.json`, it is one engineer's worktree on `eng/<name>`. Run `/quorum:sync` before the prompt when `.quorum/active.json` is absent. The coordinator takes one claimed signature and passes `--from` for the slice. It skips a snapshot whose job file is `closed: true`.

If `.quorum/active.json` exists at the start, the session repeats the merge line and stops. Ready means `/quorum:close`. `one-way door stops for the lead` means the lead's handoff, and not close yet. In the session that opened the job, a red trace means that session repeats the worker and the verifier until the trace passes. A later session does not dispatch. If the original session is gone, the human deletes `.quorum/active.json` outside the session.

With no active job, fast-forward is `git merge --ff-only <integrationBranch>` outside Claude. Exit 0, including already up to date, still allows `/quorum:sync`. Unique commits with no active job stop there. Do not sync a stale tree.

Two-way finish is `/quorum:close`, then the lead merges local `eng/<name>`, then `land`. One-way finish is `git worktree add --detach <treesDir>/review-<name> eng/<name>` with no fetch, `lead-ack`, then `git -C <treesDir>/review-<name>` add, commit, and `branch -f ack/<snapshot> HEAD`, then the engineer runs `git merge --ff-only ack/<snapshot>` and `/quorum:close`. The lead merges that local `eng/<name>` only after the fast-forward, runs `land`, and removes the review worktree from the integration checkout after the ack file is on `ack/<snapshot>`.
