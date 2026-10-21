# Quorum

A Claude Code plugin for an agent factory. A scanner files work. A coordinator groups it and dispatches. One coding worker handles one signature. One verifier returns a verdict. A human samples and merges.

The method comes from Lauren Tan's 2 October 2026 conversation with Matt Pocock, as filed at [postgrok.com](https://postgrok.com/concepts/michelin-kitchen-metaphor). The product name is Quorum. The research notes keep her kitchen metaphor. Dune, the internal framework named in the captions, is not cloned. What is copied is the constraint surface those captions describe: feature directories, a failing lint, and a second identical mistake that becomes a rule.

## Install

Claude Code loads this directory as a plugin. From a target repository:

```bash
cd /absolute/path/to/grok_bot_harness_v1.0/examples/target
claude --plugin-dir /absolute/path/to/grok_bot_harness_v1.0 --agent quorum:coordinator
```

The one prompt is `Work the confirmed buffer.` The coordinator dispatches one confirmed signature, then stops with a verdict. A second signature waits until `/quorum:close` and a new session. The same contract non-interactively:

```bash
claude --plugin-dir /absolute/path/to/grok_bot_harness_v1.0 --agent quorum:coordinator -p "Work the confirmed buffer."
```

`examples/target` is a codebase, not a copy of the plugin. Its `CLAUDE.md` is what Claude Code reads as project context. The plugin supplies the commands, the agents, and the hooks. Putting this harness inside the target's `.claude/` folder does not load it: Claude Code looks for plugin components at the plugin root, and it does not treat a `CLAUDE.md` in the plugin root as project context.

The plugin name is `quorum`. Inside the session the slash menu shows:

- `/quorum:status` prints the active job, the buffer, and the latest trace.
- `/quorum:job <feature> <two-way|one-way> <intent>` opens a snapshot.
- `/quorum:buffer add <summary>` appends a row. `/quorum:buffer assign` groups rows.
- `/quorum:verify`, `/quorum:constrain`, `/quorum:sample`, `/quorum:check`, and `/quorum:corrections` are the skills Claude also loads when the work matches them.
- `/quorum:close` releases a job after `merge-status` says it is ready. Closing does not merge.

Agents are `quorum:coordinator`, `quorum:worker`, `quorum:verifier`, and `quorum:scanner`.

Node 20 or newer is required. From this harness repository, install the one runtime dependency and the browser the swarm drives:

```bash
npm install
npx playwright install chromium
```

Hooks run inside the session, not as a separate program you start:

- Session start injects the current quorum status once. Later prompts are not restated.

- Before Bash, Write, or Edit, the plugin denies `git merge`, `git push`, `git rebase`, `gh pr merge`, any edit under `.quorum/`, and any edit outside `features/<feature>/` while a job is active. While a job is active, Bash also denies a command that names `.quorum`, a redirect or writer outside that feature, and shell eval, pipes, and command substitution.
- After a Write or Edit under `features/`, lint findings come back as a block.
- Stop and subagent stop stay blocked until the active job has a passing trace.

## Greenfield

A greenfield project is a new repository. Quorum stays in this repo. The new repository is the codebase.

```bash
mkdir my-app && cd my-app
git init
printf '%s\n' '.quorum/' > .gitignore
```

Copy `examples/target/CLAUDE.md` into the new repository and change the `--plugin-dir` path to this harness. Copy `examples/target/package.json` when the project is JavaScript, so `features/<name>/check.js` can import the feature. Add the first feature and a check that fails when the feature is wrong:

```bash
mkdir -p features/alpha .claude
```

`features/alpha/feature.js` holds the code. `features/alpha/check.js` is the check. Start the coordinator from the new repository:

```bash
claude --plugin-dir /absolute/path/to/grok_bot_harness_v1.0 --agent quorum:coordinator
```

Create `features/alpha/check.js` before opening the job. `/quorum:job` refuses an empty check and refuses a check file that is not there yet.

```bash
/quorum:check alpha
/quorum:job alpha two-way "Add the first feature"
```

The snapshot check is `node features/alpha/check.js`. The door is `two-way` while the change can be reverted by dropping the commit. Use `one-way` when the change publishes, deletes data, or cannot be undone. The human runs `/quorum:close` after `merge-status` says the trace passed, then merges. Close releases the feature fence. It does not merge. To abandon a job that is not ready, delete `.quorum/active.json` from a terminal outside the Claude session.

`.quorum/` is session state. Leave it gitignored. Do not commit the plugin into the new repository, and do not place this harness under the new repository's `.claude/`.

## Brownfield

A brownfield project is a repository that already has code, usually outside `features/`. Launch the same way, from that repository's root, with `--plugin-dir` pointed at this harness and `--agent quorum:coordinator`. Add `.quorum/` to the repository's `.gitignore`, and add a `CLAUDE.md` that names the existing test command and the feature directory the next job may touch.

The lint reads only `features/<name>/*.{js,mjs}`. Python, Go, and the rest of an existing tree are outside that lint. The snapshot check can still be the repository's own command, such as `npm test` or `pytest tests/test_billing.py`, as long as the command does not merge, push, or rebase.

Adopt one slice at a time.

1. File the smell. Do not start one agent per bug.

   ```bash
   node /absolute/path/to/grok_bot_harness_v1.0/scripts/quorum.js buffer-add --root . --summary "Invoice total drops cents" --signature invoice-total --source human --confirmed
   ```

2. Create `features/<name>/` for that slice and a check that fails on the current code and passes after the fix. Keep the existing tree where it is until the slice moves.
3. Open the job only after that check exists. A second `job-open` is refused while `.quorum/active.json` exists. The session refuses edits outside `features/<name>/` and refuses edits under `.quorum/`. Change legacy paths before `job-open`. Abandon a job that is not ready by deleting `.quorum/active.json` outside the session. After `merge-status` is ready, `/quorum:close` is the normal release.
4. Do not move a large existing file under `features/` in one step. A file over 80 lines fails `line-cap`. Split the slice until it fits, or raise the cap with `verify --line-cap`. That value is stored in `.quorum/lint.json`, and the edit hook uses it on the next edit. The snapshot check itself may take up to 300 seconds. Raise that with `verify --check-timeout <seconds>`.
5. A cross-import between feature directories fails `cross-feature-import`. An import from `features/billing` into the old `src/` tree is outside the lint.
6. When the same shortcut shows up twice, `/quorum:constrain` writes `.quorum/proposed/<signature>.md`. Apply that rule in the existing repository's lint or types. Quorum does not edit that configuration for you.

A migration, a public API removal, or a data rewrite is a `one-way` door. `merge-status` refuses it until the snapshot carries a reversible check and verify has passed. The human still merges.

## How a job moves

1. A scanner appends a row. It does not fix it.

   ```bash
   node /absolute/path/to/grok_bot_harness_v1.0/scripts/quorum.js buffer-add --root . --summary "Null menu on launch" --signature null-menu --source slack
   ```

2. The coordinator, started with `--agent quorum:coordinator`, groups rows that share a signature and spawns one `quorum:worker` for the first signature only. It has no Write, Edit, or Bash tool. It can spawn `quorum:worker`, `quorum:verifier`, and `quorum:scanner` only. On this path it does not spawn the scanner.
3. A worker opens a snapshot and edits only `features/<name>/`.

   ```bash
   node /absolute/path/to/grok_bot_harness_v1.0/scripts/quorum.js job-open --root . --feature alpha --door two-way --intent "Rename the menu label" --check "node features/alpha/check.js"
   ```

4. `scripts/quorum.js verify --root .` runs the feature-directory lint and the snapshot's check, then writes `.quorum/traces/latest.json`. A clean lint with no check is still red. The worker is not done without `"passed": true`. Inside Claude Code the skills expand `${CLAUDE_PLUGIN_ROOT}` to this plugin. The snapshot itself is `.quorum/snapshots/<id>.md` and is not refreshed mid-run.
5. The verifier re-runs that command and `merge-status`. It does not edit. While the verdict is red, the same coordinator session spawns that worker again, then the verifier again, until the trace passes or the turn limit stops the loop. A later session that finds `.quorum/active.json` already there does not spawn either agent.
6. A human merges. `merge-status` never merges. A one-way door without `--check` is refused. There is no overnight self-merge command. When the verdict is ready, the human runs `/quorum:close`. That removes `.quorum/active.json` and leaves the job record and the trace. The next slice can open.

While `.quorum/active.json` exists, the Stop hook keeps the session going until the trace for that job is green, unless the hook is already a continuation (`stop_hook_active`). Abandon a job that is not ready by deleting `.quorum/active.json` outside the session. `job-close` refuses a red trace.

## Constraint surface

`features/<name>/*.{js,mjs}` is the only tree the lint reads.

- A file longer than 80 lines fails `line-cap`. The captions describe god files of thousands of lines, not a number. Eighty is the stand-in so a god file fails closed. `verify --line-cap` stores the new cap in `.quorum/lint.json`. The next verify, and the edit hook, both use that cap.
- An `import`, `export ... from`, or `require` whose specifier resolves into another feature directory, or starts with `features/<other>`, fails `cross-feature-import`.
- Files outside `features/` are ignored. Lint is the environment. It is not the verification trace.

A PostToolUse hook on Write and Edit runs this lint when the edited path contains `features`, and blocks the turn with the finding so Claude hits the rule instead of remembering it. A PreToolUse hook refuses the edit before it lands when it would write `.quorum/` or leave the active feature.

The second `failure-add` for one signature writes `.quorum/proposed/<signature>.md`. A human applies that rule in the target repo. There is no command that marks the shortcut resolved.

`examples/target/.claude/settings.json` allows `Bash(node features/*/check.js)` and `Bash(node *quorum.js *)`. Copy those two lines into a target that should run the coordinator without a permission prompt. Do not add `Bash(node *)`.

## Tests

```bash
node --test scripts/quorum.spec.js
```

The fixture at `examples/fixture` is a clean feature tree. Verify stays red until a snapshot names a check:

```bash
node scripts/quorum.js job-open --root examples/fixture --feature alpha --door two-way --intent "Keep the fixture" --check "node features/alpha/check.js"
node scripts/quorum.js verify --root examples/fixture
```

## Factory patterns

These are the agent-factory pages on Postgrok, and the part of each one this repo runs.

- Trust ladder. `.quorum/trust.json` starts at `verification` with `merge` set to `human`. The second identical shortcut sets the rung to `sampling`. The merge field stays `human`.
- Verification. `verify` runs the feature check named on the snapshot. A command that only exits 0 is refused. While the job is active, the check file cannot be edited. `/quorum:check` writes `features/<name>/check.js` and `VERIFY.md` when they are missing. When `features/<name>/swarm/*.js` exists, `swarm --count N` drives the page in N isolated Playwright sessions, from 1 to 10. `--fuzz` clicks and fills from a fixed seed. The merge gate stays red until that swarm trace passes. The verifier runs the command and does not edit.
- Environment. The feature lint and `/quorum:constrain` are the constraints. A proposal is a file a human applies.
- Inner and outer loop. The snapshot is the inner intent. `buffer-add` without `--confirmed`, and `intake --file orders.json`, land in `.quorum/inbox.json`. Confirmed rows are the buffer, grouped by signature. `intake` is the connector shape. It does not call Slack, Linear, X, or email.
- One-way doors. `merge-status` refuses a one-way door with an empty check, and it never merges.
- Skills as process. The workflow is markdown. The decisions are `scripts/quorum.js`. `/quorum:corrections` appends a human correction and can count it as a shortcut.
- Sampling. `/quorum:sample` reads the buffer and the trust rung. `sample-note` appends what was sampled. It does not raise trust.

## What this plugin does not do

It does not call the xAI API, subscribe to Slack, or merge while you sleep. A connector, when added, should only append a buffer row. The Playwright swarm is one verifier running up to ten browser sessions, not ten coding agents.

## Shared verification

When `team/check.js` exists, `verify` runs the feature-directory lint, refuses a noop body in that file, runs `node team/check.js`, then still runs the snapshot check unless that command is exactly `node team/check.js`. `passed` requires every command that ran to exit 0. The trace adds `team_exit`, which is `null` when the file is absent. Every verify rewrites `.quorum/lint.json` with the cap it used. `examples/team/check.js` is the shape the lead copies: it runs each `features/*/check.js` and exits 1 with `no feature checks` when none exist. The plugin does not prove the script calls every feature check. Do not add `Bash(node *)`.

## Worktrees

`team/kitchen.json` opts a repo into team mode. `tree-add --engineer <name>` creates `eng/<name>` from `integrationBranch` and a worktree under `treesDir`, which must sit outside the primary worktree. A later `tree-add` reattaches that branch when it is not checked out, and it does not delete the branch. `tree-remove` refuses while `.quorum/active.json` exists and does not delete the branch. `openJob` on the primary checkout throws in team mode.

`git merge --ff-only <integrationBranch>` is a human command outside Claude, and only when `active.json` is absent. An exit 0 that is already up to date still allows `note-sync`. If `eng/<name>` has unique commits and there is no active job, the human stops and does not sync a stale tree. The plugin does not merge, pull, or rebase. Do not commit `team/kitchen.json` on a product repo until `land` can release a claim.

## Claims

`claim --signature <slug> --engineer <name>` writes `team/claims.json`. One engineer has one open claim. A signature claimed by someone else is refused. More than one `notes/**/<feature>.md` is refused. `claim` does not clear a claim. In team mode, `openJob` requires that claim, requires `--from`, and rejects a noop check. `quorum status` does not print claims. The lead reads `team/claims.json`. Claims stay unused on a product repo until `land` releases them, and `team/kitchen.json` waits for that command.

## Ack and land

`lead-ack --snapshot <id>` checks a one-way slice without reading `active.json` and without merging. It runs lint, `team/check.js` when present, the slice check, and the swarm when scenarios exist, then writes `team/acks/<snapshot>.json` with `verifiedCommit` set to `HEAD`. `land --feature <feature> --snapshot <id> --commit <sha>` records a merge the lead already made. `--commit` must be a 40-hex ancestor of `HEAD`. For a one-way slice, `verifiedCommit` must be a 40-hex ancestor of `--commit`, and equality is allowed. `land` updates `team/landed.json` and drops that signature from `team/claims.json`. Neither command merges or pushes. After `land` exists, a product repo may commit `team/kitchen.json`.

`close` sets `closed: true` on the job file and drops matching inbox and buffer rows. A signature matches only when the job signature is non-empty. A snapshot matches only when both strings are non-empty and equal. Outside team mode, a one-way job with a check and a green trace stays ready for human merge.

## Team loop

`/quorum:sync` runs `note-sync`. With no active job, the human fast-forwards `git merge --ff-only <integrationBranch>` outside Claude, including an already up to date exit, then syncs, then the coordinator takes one signature. `quorum status` prints `blocked` and `landed`. When a job is active it prints `merge:` and does not need a new `.quorum/` directory to read an idle tree.

Two-way finish: `/quorum:close`, the lead merges local `eng/<name>`, then `land`. That order does not include `git push`. `git push` stays denied inside the Claude session.

One-way finish on the shared clone, in this order: `git worktree add --detach <treesDir>/review-<name> eng/<name>` with no fetch, `lead-ack`, `git -C <treesDir>/review-<name>` add, commit, and `branch -f ack/<snapshot> HEAD`, the engineer runs `git merge --ff-only ack/<snapshot>`, `/quorum:close`, the lead merges local `eng/<name>` only after that fast-forward, `land`, then `git worktree remove` from the integration checkout. Do not remove the review path before the ack file is on `ack/<snapshot>`. A second clone is a non-goal. While `active.json` exists, skip the integration fast-forward. The coordinator repeats the merge line and does not spawn the verifier. Close when the reason is ready. Run the one-way handoff when the reason is `one-way door stops for the lead`. If the trace is red and the original session is gone, abandon by deleting `active.json` outside the session. `closed` stays unset. The unique-commit failure applies to that start-of-slice fast-forward only. `git fetch` does not update `notes/` or `team/`.

This plugin still does not self-merge, watch Slack, Linear, X, or email, build a context graph, run ten verifiers, start `claude`, or clear a shortcut with `resolved`. `land`, `lead-ack`, `claim`, `tree-add`, and `tree-remove` are terminal commands, not slash commands.
