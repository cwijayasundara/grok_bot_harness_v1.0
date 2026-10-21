import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  addRow,
  assign,
  fileReport,
  initCheck,
  intakeFile,
  isNoopCheck,
  quorumStatus,
  lintTree,
  closeJob,
  mergeStatus,
  openJob,
  postEditDecision,
  preToolDecision,
  readLineCap,
  runVerify,
  promptContext,
  recordFailure,
  sessionContext,
  listScenarios,
  stopDecision,
  swarmVerdict,
  writeSwarmTrace,
  writeTrace,
  noteCheck,
  noteSync,
  unmetDeps,
  claimSignature,
  leadAck,
  landFeature,
  treeAdd,
  treeRemove,
  readLanded,
} from "./quorum.js";
import { clampCount } from "./playwright_swarm.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "quorum-"));
}

test("lint rejects a cross-feature import and an oversized file", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  mkdirSync(path.join(root, "features", "beta"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "feature.js"), "export const VALUE = 1;\n");
  writeFileSync(
    path.join(root, "features", "beta", "feature.js"),
    "import { VALUE } from '../alpha/feature.js';\n",
  );
  mkdirSync(path.join(root, "features", "gamma"), { recursive: true });
  writeFileSync(path.join(root, "features", "gamma", "feature.js"), "export const x = 1;\n".repeat(90));

  const findings = lintTree(root, 80);
  assert.ok(findings.some((item) => item.path.includes("beta") && item.rule === "cross-feature-import"));
  assert.ok(findings.some((item) => item.rule === "line-cap"));
  assert.equal(
    findings.some((item) => item.path.includes("alpha") && item.rule === "cross-feature-import"),
    false,
  );
});

test("lint ignores files outside features", () => {
  const root = tempRoot();
  writeFileSync(path.join(root, "notes.js"), "import '../features/missing/feature.js';\n".repeat(100));
  assert.deepEqual(lintTree(root, 80), []);
});

test("the second identical shortcut proposes a constraint and leaves it for a human", () => {
  const root = tempRoot();
  const first = recordFailure(root, "cross-feature-import");
  const second = recordFailure(root, "cross-feature-import");
  assert.equal(first.action, "noted");
  assert.equal(second.action, "proposed");
  const proposal = path.join(root, ".quorum", "proposed", "cross-feature-import.md");
  assert.match(readFileSync(proposal, "utf8"), /human applies/i);
  const stored = JSON.parse(readFileSync(path.join(root, ".quorum", "failures.json"), "utf8"));
  assert.equal(stored[0].status, "proposed");
  assert.equal(stored[0].count, 2);
  const trust = JSON.parse(readFileSync(path.join(root, ".quorum", "trust.json"), "utf8"));
  assert.equal(trust.rung, "sampling");
  assert.equal(trust.merge, "human");
});

test("assign groups matching signatures into one job", () => {
  const root = tempRoot();
  addRow(root, "Null menu on launch", "null-menu", "slack");
  addRow(root, "null menu on launch", "null-menu", "linear");
  addRow(root, "Broken settings toggle", "settings-toggle", "slack");
  const jobs = assign(root);
  assert.equal(jobs.length, 2);
  const menu = jobs.find((job) => job.signature === "null-menu");
  assert.equal(menu.rowIds.length, 2);
});

test("a one-way door without a check cannot merge", () => {
  const root = tempRoot();
  const job = openJob(root, { feature: "alpha", door: "one-way", intent: "Drop a column", check: "" });
  writeTrace(root, job.id, true);
  const [allowed, reason] = mergeStatus(root, job.id);
  assert.equal(allowed, false);
  assert.match(reason, /one-way/);
});

test("a two-way job with a green trace is ready for a human", () => {
  const root = tempRoot();
  const job = openJob(root, { feature: "alpha", door: "two-way", intent: "Rename a label", check: "" });
  writeTrace(root, job.id, true);
  const [allowed, reason] = mergeStatus(root, job.id);
  assert.equal(allowed, true);
  assert.match(reason, /human/);
});

test("the stop gate blocks an active job until a passing trace exists", () => {
  const root = tempRoot();
  const job = openJob(root, { feature: "alpha", door: "two-way", intent: "Fix label", check: "" });
  assert.equal(stopDecision(root, false).decision, "block");
  writeTrace(root, job.id, false);
  assert.equal(stopDecision(root, false).decision, "block");
  writeTrace(root, job.id, true);
  assert.equal(stopDecision(root, false), null);
});

test("the stop gate allows a stop when no job is active", () => {
  const root = tempRoot();
  assert.equal(stopDecision(root, false), null);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  openJob(root, { feature: "alpha", door: "two-way", intent: "Fix label", check: "" });
  assert.equal(stopDecision(root, true), null);
});

test("verify stays red until the snapshot check runs against a clean feature", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "feature.js"), "export const VALUE = 1;\n");
  writeFileSync(
    path.join(root, "features", "alpha", "check.js"),
    "import assert from 'node:assert/strict';\nimport { VALUE } from './feature.js';\nassert.equal(VALUE, 1);\n",
  );
  const script = path.join(rootDir, "scripts", "quorum.js");
  const bare = spawnSync(process.execPath, [script, "verify", "--root", root], { encoding: "utf8" });
  assert.equal(bare.status, 1, bare.stderr);
  const opened = spawnSync(
    process.execPath,
    [
      script,
      "job-open",
      "--root",
      root,
      "--feature",
      "alpha",
      "--door",
      "two-way",
      "--intent",
      "Rename the menu label",
      "--check",
      "node features/alpha/check.js",
    ],
    { encoding: "utf8" },
  );
  assert.equal(opened.status, 0, opened.stderr);
  const completed = spawnSync(process.execPath, [script, "verify", "--root", root], { encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr);
  const trace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "latest.json"), "utf8"));
  assert.equal(trace.passed, true);
  assert.equal(trace.check_exit, 0);
  const jobId = opened.stdout.trim();
  assert.match(readFileSync(path.join(root, ".quorum", "snapshots", `${jobId}.md`), "utf8"), /Rename the menu label/);
});

test("an unconfirmed report stays in the inbox and a noop check stays red", () => {
  const root = tempRoot();
  const held = fileReport(root, "Menu is null", "null-menu", "slack", false);
  assert.equal(held.held, true);
  assert.equal(assign(root).length, 0);
  const filed = fileReport(root, "Menu is null", "null-menu", "slack", true);
  assert.equal(filed.held, false);
  assert.equal(assign(root)[0].rowIds.length, 1);
  assert.equal(isNoopCheck("node -e 'process.exit(0)'"), true);
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "feature.js"), "export const VALUE = 1;\n");
  openJob(root, { feature: "alpha", door: "two-way", intent: "Keep the value", check: "node -e 'process.exit(0)'" });
  const trace = JSON.parse(
    spawnSync(process.execPath, [path.join(rootDir, "scripts", "quorum.js"), "verify", "--root", root], { encoding: "utf8" }).stdout,
  );
  assert.equal(trace.passed, false);
  const frozen = preToolDecision(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "features", "alpha", "check.js") },
  });
  assert.equal(frozen, null);
  unlinkSync(path.join(root, ".quorum", "active.json"));
  writeFileSync(path.join(root, "features", "alpha", "check.js"), "import assert from \"node:assert/strict\";\nassert.ok(true);\n");
  openJob(root, {
    feature: "alpha",
    door: "two-way",
    intent: "Keep the value",
    check: "node features/alpha/check.js",
  });
  const blocked = preToolDecision(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "features", "alpha", "check.js") },
  });
  assert.equal(blocked.hookSpecificOutput.permissionDecision, "deny");
  const created = initCheck(root, "beta");
  assert.equal(created.created, true);
  assert.equal(existsSync(path.join(root, "features", "beta", "VERIFY.md")), true);
  assert.equal(initCheck(root, "beta").created, false);
});

test("a feature with scenarios stays blocked until the swarm trace passes", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha", "swarm"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "check.js"), "process.exitCode = 0;\n");
  writeFileSync(path.join(root, "features", "alpha", "swarm", "add.js"), "export default async function add() {}\n");
  const job = openJob(root, { feature: "alpha", door: "two-way", intent: "Count clicks", check: "node features/alpha/check.js" });
  writeTrace(root, job.id, true);
  const blocked = stopDecision(root, false);
  assert.equal(blocked.decision, "block");
  assert.match(blocked.reason, /swarm/i);
  const [allowed] = mergeStatus(root, job.id);
  assert.equal(allowed, false);
  writeSwarmTrace(root, job.id, [
    { id: 1, passed: true, detail: "" },
    { id: 2, passed: false, detail: "button missing" },
  ]);
  assert.equal(swarmVerdict([{ id: 1, passed: true }, { id: 2, passed: false }]).passed, false);
  writeSwarmTrace(root, job.id, [
    { id: 1, passed: true, detail: "" },
    { id: 2, passed: true, detail: "" },
  ]);
  assert.equal(stopDecision(root, false), null);
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount(40), 10);
  assert.equal(listScenarios(root, "alpha").length, 1);
});

test("status and session context do not create a quorum directory", () => {
  const root = tempRoot();
  assert.match(quorumStatus(root), /active: none/);
  assert.match(sessionContext(root), /\/quorum:status/);
  assert.equal(promptContext(root), null);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
});

test("the pre-tool hook blocks merge and edits outside the active feature", () => {
  const root = tempRoot();
  assert.equal(preToolDecision(root, { tool_name: "Bash", tool_input: { command: "git status" } }), null);
  const merge = preToolDecision(root, { tool_name: "Bash", tool_input: { command: "git merge main" } });
  assert.equal(merge.hookSpecificOutput.permissionDecision, "deny");
  const push = preToolDecision(root, { tool_name: "Bash", tool_input: { command: "git push origin head" } });
  assert.equal(push.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(
    preToolDecision(root, { tool_name: "Bash", tool_input: { command: "git merge-base HEAD main" } }),
    null,
  );
  const state = preToolDecision(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, ".quorum", "traces", "latest.json") },
  });
  assert.equal(state.hookSpecificOutput.permissionDecision, "deny");
  openJob(root, { feature: "alpha", door: "two-way", intent: "Rename a label", check: "" });
  assert.match(promptContext(root), /features\/alpha/);
  const outside = preToolDecision(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "README.md") },
  });
  assert.equal(outside.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(
    preToolDecision(root, {
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, "features", "alpha", "feature.js") },
    }),
    null,
  );
  const forged = preToolDecision(root, {
    tool_name: "Bash",
    tool_input: { command: "printf passed > .quorum/traces/latest.json" },
  });
  assert.equal(forged.hookSpecificOutput.permissionDecision, "deny");
  const evaluated = preToolDecision(root, {
    tool_name: "Bash",
    tool_input: { command: "node -e 'process.stdout.write(\"hi\")'" },
  });
  assert.equal(evaluated.hookSpecificOutput.permissionDecision, "deny");
  const removed = preToolDecision(root, {
    tool_name: "Bash",
    tool_input: { command: "rm README.md" },
  });
  assert.equal(removed.hookSpecificOutput.permissionDecision, "deny");
  const chained = preToolDecision(root, {
    tool_name: "Bash",
    tool_input: { command: "node features/alpha/check.js && rm README.md" },
  });
  assert.equal(chained.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(
    preToolDecision(root, {
      tool_name: "Bash",
      tool_input: { command: "node features/alpha/check.js" },
    }),
    null,
  );
  assert.equal(preToolDecision(root, { tool_name: "Bash", tool_input: { command: "git status" } }), null);
});

test("a ready job closes and releases the feature fence", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "check.js"), "process.exitCode = 0;\n");
  const job = openJob(root, {
    feature: "alpha",
    door: "two-way",
    intent: "Rename a label",
    check: "node features/alpha/check.js",
  });
  assert.throws(() => openJob(root, { feature: "beta", door: "two-way", intent: "Next", check: "" }), /already active/);
  assert.equal(existsSync(path.join(root, "features", "beta")), false);
  const held = closeJob(root);
  assert.equal(held.closed, false);
  assert.equal(existsSync(path.join(root, ".quorum", "active.json")), true);
  writeTrace(root, job.id, true);
  const closed = closeJob(root);
  assert.equal(closed.closed, true);
  assert.equal(existsSync(path.join(root, ".quorum", "active.json")), false);
  assert.equal(
    preToolDecision(root, { tool_name: "Edit", tool_input: { file_path: path.join(root, "README.md") } }),
    null,
  );
  assert.throws(
    () => openJob(root, { feature: "alpha", door: "two-way", intent: "Again", check: "node features/missing.js" }),
    /missing/,
  );
});

test("verify remembers a raised line cap and a short check timeout", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{\"type\":\"module\"}\n");
  const lines = ["export const VALUE = 1;"];
  while (lines.length < 90) lines.push("// pad");
  writeFileSync(path.join(root, "features", "alpha", "feature.js"), `${lines.join("\n")}\n`);
  writeFileSync(
    path.join(root, "features", "alpha", "check.js"),
    "import assert from \"node:assert/strict\";\nimport { VALUE } from \"./feature.js\";\nassert.equal(VALUE, 1);\n",
  );
  openJob(root, {
    feature: "alpha",
    door: "two-way",
    intent: "Keep the value",
    check: "node features/alpha/check.js",
  });
  const blocked = postEditDecision(root, {
    tool_name: "Edit",
    tool_input: { file_path: path.join(root, "features", "alpha", "feature.js") },
  });
  assert.equal(blocked.decision, "block");
  const verified = runVerify(root, 120, 300000);
  assert.equal(verified.trace.passed, true);
  assert.equal(readLineCap(root), 120);
  assert.equal(
    postEditDecision(root, {
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, "features", "alpha", "feature.js") },
    }),
    null,
  );
  unlinkSync(path.join(root, ".quorum", "active.json"));
  openJob(root, {
    feature: "alpha",
    door: "two-way",
    intent: "Time out",
    check: "node -e \"setTimeout(() => {}, 5000)\"",
  });
  const slow = runVerify(root, 120, 200);
  assert.equal(slow.trace.passed, false);
  assert.equal(slow.trace.timed_out, true);
});

test("the playwright swarm clicks the alpha page", { timeout: 60000 }, async (t) => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const script = path.join(rootDir, "scripts", "quorum.js");
  const root = path.join(rootDir, "examples", "target");
  rmSync(path.join(root, ".quorum"), { recursive: true, force: true });
  const opened = spawnSync(
    process.execPath,
    [script, "job-open", "--root", root, "--feature", "alpha", "--door", "two-way", "--intent", "Count clicks", "--check", "node features/alpha/check.js"],
    { encoding: "utf8" },
  );
  assert.equal(opened.status, 0, opened.stderr);
  const completed = spawnSync(process.execPath, [script, "swarm", "--root", root, "--count", "2", "--fuzz", "2"], {
    encoding: "utf8",
    timeout: 50000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const trace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "swarm.json"), "utf8"));
  assert.equal(trace.passed, true);
  assert.equal(trace.count, 2);
  rmSync(path.join(root, ".quorum"), { recursive: true, force: true });
});

test("plugin agents keep the coordinator from editing", () => {
  const coordinator = readFileSync(path.join(rootDir, "agents", "coordinator.md"), "utf8");
  const verifier = readFileSync(path.join(rootDir, "agents", "verifier.md"), "utf8");
  const worker = readFileSync(path.join(rootDir, "agents", "worker.md"), "utf8");
  const scanner = readFileSync(path.join(rootDir, "agents", "scanner.md"), "utf8");
  const coordinatorFront = coordinator.split("---")[1];
  const verifierFront = verifier.split("---")[1];
  const workerFront = worker.split("---")[1];
  const scannerFront = scanner.split("---")[1];
  assert.match(coordinatorFront, /tools: Agent\(quorum:worker, quorum:verifier, quorum:scanner\), Read, Grep, Glob/);
  assert.match(coordinatorFront, /omitClaudeMd: true/);
  assert.match(coordinatorFront, /maxTurns: 12/);
  assert.match(coordinator, /one signature/);
  assert.match(coordinator, /quorum:worker/);
  assert.match(coordinator, /claims/);
  assert.match(coordinator, /--from/);
  assert.match(coordinator, /closed/);
  assert.match(coordinator, /merge line/);
  assert.match(coordinator, /\/quorum:close/);
  assert.match(coordinator, /abandon/);
  assert.match(coordinator, /Do not spawn the worker/);
  assert.equal(coordinator.includes("job-close"), false);
  const jobCommand = readFileSync(path.join(rootDir, "commands", "job.md"), "utf8");
  assert.equal(jobCommand.includes('--check ""'), false);
  assert.match(jobCommand, /node features\/\$feature\/check\.js/);
  assert.equal(coordinatorFront.includes("Write"), false);
  assert.equal(coordinatorFront.includes("Bash"), false);
  assert.equal(verifierFront.includes("Edit"), false);
  assert.equal(verifierFront.includes("Write"), false);
  assert.match(verifierFront, /omitClaudeMd: true/);
  assert.match(workerFront, /omitClaudeMd: true/);
  assert.match(workerFront, /maxTurns: 20/);
  assert.match(worker, /check-init/);
  assert.match(scannerFront, /omitClaudeMd: true/);
  assert.match(worker, /Bash/);
  assert.match(worker, /name: worker/);
  const claudeMd = readFileSync(path.join(rootDir, "examples", "target", "CLAUDE.md"), "utf8");
  assert.match(claudeMd, /--agent quorum:coordinator/);
  assert.equal(/spawn `?quorum:worker/.test(claudeMd), false);
  const settings = readFileSync(path.join(rootDir, "examples", "target", ".claude", "settings.json"), "utf8");
  assert.match(settings, /node \*quorum\.js \*/);
  assert.equal(settings.includes("Bash(node *)"), false);
});

test("a buffer row keeps an optional feature and door", () => {
  const root = tempRoot();
  const filed = fileReport(root, "Drop cents", "invoice-total", "human", true, {
    feature: "billing",
    door: "one-way",
  });
  assert.equal(filed.held, false);
  const buffer = JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8"));
  assert.equal(buffer[0].feature, "billing");
  assert.equal(buffer[0].door, "one-way");
  assert.match(readFileSync(path.join(root, ".quorum", "buffer.md"), "utf8"), /\[billing\]/);
  const plain = fileReport(root, "Label", "rename-label", "human", true);
  const again = JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8"));
  const stored = again.find((row) => row.id === plain.id);
  assert.equal(Object.hasOwn(stored, "feature"), false);
  assert.equal(Object.hasOwn(stored, "door"), false);
  assert.throws(
    () => fileReport(root, "Bad", "bad-door", "human", true, { door: "sideways" }),
    /two-way or one-way/,
  );
  const orders = path.join(root, "orders.json");
  writeFileSync(
    orders,
    `${JSON.stringify([
      { summary: "Held", signature: "held-row", source: "intake", confirmed: false, feature: "billing", door: "two-way" },
      { summary: "Ready", signature: "ready-row", source: "intake", confirmed: true, feature: "billing", door: "one-way" },
    ])}\n`,
  );
  intakeFile(root, orders);
  const inbox = JSON.parse(readFileSync(path.join(root, ".quorum", "inbox.json"), "utf8"));
  assert.equal(inbox[0].feature, "billing");
  assert.equal(inbox[0].door, "two-way");
  assert.equal(inbox[0].confirmed, false);
  const ready = JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8")).find(
    (row) => row.signature === "ready-row",
  );
  assert.equal(ready.feature, "billing");
  assert.equal(ready.door, "one-way");
});

function writeSlice(root, note, feature, fields, body) {
  const dir = path.join(root, "notes", note);
  mkdirSync(dir, { recursive: true });
  const check = fields.check || `node features/${feature}/check.js`;
  const text = [
    "---",
    `id: ${fields.id}`,
    `signature: ${fields.signature}`,
    `feature: ${feature}`,
    `door: ${fields.door}`,
    `depends_on: ${JSON.stringify(fields.depends_on || [])}`,
    `check: ${JSON.stringify(check)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  writeFileSync(path.join(dir, `${feature}.md`), text);
  return path.join("notes", note, `${feature}.md`);
}

function gitQuiet(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function gitRepo() {
  const root = tempRoot();
  gitQuiet(root, ["init", "-b", "main"]);
  gitQuiet(root, ["config", "user.email", "quorum@example.com"]);
  gitQuiet(root, ["config", "user.name", "Quorum"]);
  writeFileSync(path.join(root, ".gitignore"), ".quorum/\n");
  writeFileSync(path.join(root, "README.md"), "root\n");
  gitQuiet(root, ["add", ".gitignore", "README.md"]);
  gitQuiet(root, ["commit", "-m", "init"]);
  return root;
}

test("slice fields are rejected before any row is written", () => {
  const root = tempRoot();
  assert.throws(
    () => fileReport(root, "Cents", "invoice-cents", "human", true, { depends_on: ["billing"] }),
    /note-sync/,
  );
  assert.throws(() => fileReport(root, "Cents", "invoice-cents", "human", true, { snapshot: "snap" }), /note-sync/);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  const orders = path.join(root, "orders.json");
  writeFileSync(
    orders,
    `${JSON.stringify([
      { summary: "Held", signature: "held-row", confirmed: false },
      { summary: "Bad", signature: "bad-row", confirmed: true, check: "node features/billing/check.js" },
    ])}\n`,
  );
  assert.throws(() => intakeFile(root, orders), /note-sync/);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
});

test("note-sync promotes a slice only after its dependency has landed", () => {
  const root = tempRoot();
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  const idle = noteSync(root);
  assert.equal(idle.buffer, 0);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  writeSlice(root, "2026-10-21-invoice", "invoice", {
    id: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    door: "two-way",
    depends_on: ["billing"],
  }, "Cents on the invoice total survive rounding.");
  const held = noteSync(root);
  assert.equal(held.inbox, 1);
  assert.equal(held.buffer, 0);
  const inbox = JSON.parse(readFileSync(path.join(root, ".quorum", "inbox.json"), "utf8"));
  assert.deepEqual(inbox[0].blocked, ["billing"]);
  assert.equal(inbox[0].confirmed, false);
  assert.equal(inbox[0].snapshot, "2026-10-21-invoice-cents");
  assert.equal(unmetDeps(root, ["billing"]).join(","), "billing");
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "landed.json"),
    `${JSON.stringify({ version: 1, features: { billing: { snapshot: "bill", signature: "billing-total", commit: "a".repeat(40), landedAt: "2026-10-21" } } }, null, 2)}\n`,
  );
  const promoted = noteSync(root);
  assert.equal(promoted.inbox, 0);
  assert.equal(promoted.buffer, 1);
  const again = noteSync(root);
  assert.equal(again.buffer, 1);
  const buffer = JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8"));
  assert.equal(buffer.length, 1);
  assert.equal(buffer[0].summary, "Cents on the invoice total survive rounding.");
});

test("note-check rejects cycles, duplicate features, and a false noop", () => {
  const root = tempRoot();
  writeSlice(root, "note", "alpha", { id: "alpha-one", signature: "alpha-one", door: "two-way", depends_on: ["beta"] }, "Alpha.");
  writeSlice(root, "note", "beta", { id: "beta-one", signature: "beta-one", door: "two-way", depends_on: ["alpha"] }, "Beta.");
  assert.ok(noteCheck(root).some((error) => /cycle/.test(error.reason)));
  writeSlice(root, "other", "alpha", { id: "alpha-two", signature: "alpha-two", door: "two-way", depends_on: [] }, "Other.");
  assert.ok(noteCheck(root).some((error) => error.field === "feature"));
  const bare = tempRoot();
  mkdirSync(path.join(bare, "notes", "note"), { recursive: true });
  writeFileSync(
    path.join(bare, "notes", "note", "gamma.md"),
    `---\nid: gamma-one\nsignature: gamma-one\nfeature: gamma\ndoor: two-way\ndepends_on: []\ncheck: "false"\n---\n\nGamma.\n`,
  );
  assert.ok(noteCheck(bare).some((error) => error.field === "check" && error.reason === "refused"));
});

test("note-sync skips a signature-only buffer row and drops a closed snapshot", () => {
  const root = tempRoot();
  fileReport(root, "Old smell", "invoice-cents", "human", true);
  writeSlice(root, "note", "invoice", {
    id: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    door: "two-way",
    depends_on: [],
  }, "Cents survive.");
  const skipped = noteSync(root);
  assert.match(skipped.messages.join("\n"), /skipped invoice-cents: buffer row has no snapshot/);
  const buffer = JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8"));
  assert.equal(buffer.length, 1);
  assert.equal(Object.hasOwn(buffer[0], "snapshot"), false);
  unlinkSync(path.join(root, ".quorum", "buffer.json"));
  noteSync(root);
  mkdirSync(path.join(root, ".quorum", "jobs"), { recursive: true });
  writeFileSync(
    path.join(root, ".quorum", "jobs", "job.json"),
    `${JSON.stringify({ id: "job", snapshot: "2026-10-21-invoice-cents", closed: true })}\n`,
  );
  const consumed = noteSync(root);
  assert.equal(consumed.buffer, 0);
  assert.equal(JSON.parse(readFileSync(path.join(root, ".quorum", "buffer.json"), "utf8")).length, 0);
});

test("openJob refuses an unmet dependency and still accepts a noop check outside team mode", () => {
  const root = tempRoot();
  assert.throws(
    () => openJob(root, { feature: "invoice", door: "two-way", intent: "Cents", check: "", depends_on: ["billing"] }),
    /dependency has not merged: billing/,
  );
  const job = openJob(root, { feature: "alpha", door: "two-way", intent: "Keep", check: "node -e 'process.exit(0)'" });
  assert.equal(job.closed, false);
  assert.deepEqual(job.depends_on, []);
});

test("a team check runs before the feature check and a noop body stays red", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "features", "alpha"), { recursive: true });
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(path.join(root, "features", "alpha", "feature.js"), "export const VALUE = 1;\n");
  writeFileSync(
    path.join(root, "features", "alpha", "check.js"),
    "import assert from 'node:assert/strict';\nimport { VALUE } from './feature.js';\nassert.equal(VALUE, 1);\n",
  );
  writeFileSync(path.join(root, "team", "check.js"), "process.exit(0)\n");
  openJob(root, { feature: "alpha", door: "two-way", intent: "Keep", check: "node features/alpha/check.js" });
  const refused = runVerify(root, 80, 300000);
  assert.equal(refused.trace.passed, false);
  assert.equal(refused.trace.team_exit, null);
  writeFileSync(path.join(root, "team", "check.js"), "process.stderr.write('team failed\\n');\nprocess.exit(2);\n");
  const both = runVerify(root, 80, 300000);
  assert.equal(both.trace.passed, false);
  assert.equal(both.trace.team_exit, 2);
  assert.equal(both.trace.check_exit, 0);
  writeFileSync(path.join(root, "team", "check.js"), "process.exitCode = 0;\n");
  const green = runVerify(root, 80, 300000);
  assert.equal(green.trace.passed, true);
  assert.equal(green.trace.team_exit, 0);
  const example = readFileSync(path.join(rootDir, "examples", "team", "check.js"), "utf8");
  assert.equal(isNoopCheck(example.trim()), false);
  const bare = tempRoot();
  mkdirSync(path.join(bare, "features", "alpha"), { recursive: true });
  writeFileSync(path.join(bare, "features", "alpha", "check.js"), "process.exitCode = 0;\n");
  openJob(bare, { feature: "alpha", door: "two-way", intent: "Keep", check: "node features/alpha/check.js" });
  const plain = runVerify(bare);
  assert.equal(plain.trace.passed, true);
  assert.equal(plain.trace.team_exit, null);
});

test("tree-add reattaches eng/<name> and openJob refuses the primary checkout", () => {
  const root = gitRepo();
  const trees = path.join(path.dirname(root), `trees-${path.basename(root)}`);
  mkdirSync(path.join(root, "features", "invoice"), { recursive: true });
  writeFileSync(path.join(root, "features", "invoice", "check.js"), "process.exitCode = 0;\n");
  const note = writeSlice(root, "note", "invoice", {
    id: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    door: "two-way",
    depends_on: [],
  }, "Cents survive.");
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "kitchen.json"),
    `${JSON.stringify({ version: 1, integrationBranch: "main", treesDir: path.relative(root, trees) }, null, 2)}\n`,
  );
  gitQuiet(root, ["add", "features", "notes", "team"]);
  gitQuiet(root, ["commit", "-m", "kitchen"]);
  assert.throws(
    () => openJob(root, { feature: "invoice", door: "two-way", intent: "Cents", check: "node features/invoice/check.js", fromFile: true, snapshot: "2026-10-21-invoice-cents", signature: "invoice-cents" }),
    /integration checkout is the lead's/,
  );
  const added = treeAdd(root, "ada");
  assert.match(added.branch, /^eng\/ada$/);
  assert.equal(JSON.parse(readFileSync(path.join(added.path, ".quorum", "engineer.json"), "utf8")).name, "ada");
  assert.throws(() => treeAdd(root, "ada"), /already exists/);
  rmSync(added.path, { recursive: true, force: true });
  assert.throws(() => treeAdd(root, "ada"), /already checked out/);
  gitQuiet(root, ["worktree", "prune"]);
  const held = treeAdd(root, "ada");
  writeFileSync(path.join(held.path, ".quorum", "active.json"), "{}\n");
  assert.throws(() => treeRemove(root, "ada"), /active\.json exists/);
  assert.equal(gitQuiet(root, ["show-ref", "--verify", "refs/heads/eng/ada"]).length > 0, true);
  unlinkSync(path.join(held.path, ".quorum", "active.json"));
  treeRemove(root, "ada");
  assert.equal(gitQuiet(root, ["show-ref", "--verify", "refs/heads/eng/ada"]).length > 0, true);
  const again = treeAdd(root, "ada");
  claimSignature(again.path, { signature: "invoice-cents", engineer: "ada" });
  const job = openJob(again.path, {
    feature: "invoice",
    door: "two-way",
    intent: "ignored",
    check: "node features/invoice/check.js",
    snapshot: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    note,
    fromFile: true,
  });
  assert.equal(job.engineer, "ada");
  assert.throws(
    () => openJob(again.path, { feature: "invoice", door: "two-way", intent: "x", check: "node -e 'process.exit(0)'", snapshot: "2026-10-21-invoice-cents", signature: "invoice-cents", fromFile: true }),
    /already active/,
  );
  unlinkSync(path.join(again.path, ".quorum", "active.json"));
  assert.throws(
    () => openJob(again.path, { feature: "invoice", door: "two-way", intent: "x", check: "node -e 'process.exit(0)'", snapshot: "2026-10-21-invoice-cents", signature: "invoice-cents", fromFile: true }),
    /refused/,
  );
  assert.throws(
    () => openJob(again.path, { feature: "invoice", door: "two-way", intent: "x", check: "node features/invoice/check.js", snapshot: "2026-10-21-invoice-cents", signature: "invoice-cents" }),
    /team mode requires --from/,
  );
  unlinkSync(path.join(again.path, "team", "claims.json"));
  treeRemove(root, "ada");
  rmSync(trees, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("a summary containing claim and a root containing land are not denied", () => {
  const root = tempRoot();
  assert.equal(
    preToolDecision(root, {
      tool_name: "Bash",
      tool_input: { command: 'node quorum.js buffer-add --summary "please claim this" --signature invoice --source human' },
    }),
    null,
  );
  assert.equal(
    preToolDecision(root, {
      tool_name: "Bash",
      tool_input: { command: "node quorum.js status --root /tmp/land" },
    }),
    null,
  );
  const denied = preToolDecision(root, {
    tool_name: "Bash",
    tool_input: { command: "node quorum.js claim --signature invoice --engineer ada" },
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  const notes = preToolDecision(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "notes", "plan.md") },
  });
  assert.equal(notes.hookSpecificOutput.permissionDecision, "deny");
  const inside = preToolDecision(root, {
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "features", "invoice", "notes", "local.md") },
  });
  assert.equal(inside, null);
  const script = path.join(rootDir, "scripts", "quorum.js");
  const landed = spawnSync(process.execPath, [script, "land", "--root", root], { encoding: "utf8" });
  assert.equal(landed.status, 2);
});

test("close waits for the lead ack only after a green trace, and land accepts a descendant commit", async () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "kitchen.json"),
    `${JSON.stringify({ version: 1, integrationBranch: "main", treesDir: "../trees" }, null, 2)}\n`,
  );
  const job = {
    id: "abcd1234",
    snapshot: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    feature: "invoice",
    door: "one-way",
    intent: "Publish",
    check: "node features/invoice/check.js",
    depends_on: [],
    note: "notes/note/invoice.md",
    engineer: "ada",
    closed: false,
  };
  mkdirSync(path.join(root, ".quorum", "jobs"), { recursive: true });
  writeFileSync(path.join(root, ".quorum", "jobs", `${job.id}.json`), `${JSON.stringify(job)}\n`);
  writeFileSync(path.join(root, ".quorum", "active.json"), `${JSON.stringify(job)}\n`);
  writeTrace(root, job.id, false, { team_exit: null, check_exit: 1, lint_clean: true, timed_out: false });
  const red = mergeStatus(root, job.id);
  assert.equal(red[0], false);
  assert.match(red[1], /no fresh passing verify trace/);
  assert.equal(/lead/.test(red[1]), false);
  writeTrace(root, job.id, true, { team_exit: null, check_exit: 0, lint_clean: true, timed_out: false });
  const waiting = closeJob(root);
  assert.equal(waiting.closed, false);
  assert.match(waiting.reason, /one-way door stops for the lead/);
  mkdirSync(path.join(root, "team", "acks"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "acks", `${job.snapshot}.json`),
    `${JSON.stringify({ snapshot: job.snapshot, feature: "invoice", door: "one-way", verifiedCommit: "b".repeat(40), ackedAt: "2026-10-21" })}\n`,
  );
  const closed = closeJob(root);
  assert.equal(closed.closed, true);
  assert.equal(JSON.parse(readFileSync(path.join(root, ".quorum", "jobs", `${job.id}.json`), "utf8")).closed, true);

  const plain = tempRoot();
  fileReport(plain, "Label", "rename-label", "human", true);
  const smell = openJob(plain, { feature: "alpha", door: "two-way", intent: "Label", check: "" });
  writeTrace(plain, smell.id, true);
  closeJob(plain);
  const kept = JSON.parse(readFileSync(path.join(plain, ".quorum", "buffer.json"), "utf8"));
  assert.equal(kept.length, 1);

  const repo = gitRepo();
  mkdirSync(path.join(repo, "features", "invoice"), { recursive: true });
  writeFileSync(path.join(repo, "features", "invoice", "check.js"), "process.exitCode = 0;\n");
  writeSlice(repo, "note", "invoice", {
    id: "2026-10-21-invoice-cents",
    signature: "invoice-cents",
    door: "one-way",
    depends_on: [],
  }, "Publish the total.");
  mkdirSync(path.join(repo, "team"), { recursive: true });
  writeFileSync(
    path.join(repo, "team", "kitchen.json"),
    `${JSON.stringify({ version: 1, integrationBranch: "main", treesDir: "../outside-trees" }, null, 2)}\n`,
  );
  gitQuiet(repo, ["add", "features", "notes", "team"]);
  gitQuiet(repo, ["commit", "-m", "slice"]);
  const featureSha = gitQuiet(repo, ["rev-parse", "HEAD"]);
  const ack = await leadAck(repo, { snapshot: "2026-10-21-invoice-cents" });
  assert.equal(ack.verifiedCommit, featureSha);
  claimSignature(repo, { signature: "invoice-cents", engineer: "ada" });
  const equal = landFeature(repo, { feature: "invoice", snapshot: "2026-10-21-invoice-cents", commit: featureSha });
  assert.equal(equal.commit, featureSha);
  assert.equal(JSON.parse(readFileSync(path.join(repo, "team", "claims.json"), "utf8")).claims["invoice-cents"], undefined);
  gitQuiet(repo, ["commit", "--allow-empty", "-m", "merge invoice"]);
  const mergeSha = gitQuiet(repo, ["rev-parse", "HEAD"]);
  assert.notEqual(mergeSha, featureSha);
  claimSignature(repo, { signature: "invoice-cents", engineer: "ada" });
  const later = landFeature(repo, { feature: "invoice", snapshot: "2026-10-21-invoice-cents", commit: mergeSha });
  assert.equal(later.commit, mergeSha);
  assert.equal(readLanded(repo).features.invoice.snapshot, "2026-10-21-invoice-cents");
  rmSync(repo, { recursive: true, force: true });
});

test("team mode counts jsonl lines and does not write resolved", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "kitchen.json"),
    `${JSON.stringify({ version: 1, integrationBranch: "main", treesDir: "../trees" }, null, 2)}\n`,
  );
  assert.throws(() => recordFailure(root, "line-cap"), /engineer name is missing/);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  assert.equal(existsSync(path.join(root, "team", "failures.jsonl")), false);
  mkdirSync(path.join(root, ".quorum"), { recursive: true });
  writeFileSync(path.join(root, ".quorum", "engineer.json"), `${JSON.stringify({ name: "ada" })}\n`);
  const first = recordFailure(root, "line-cap");
  assert.equal(first.action, "noted");
  assert.equal(first.count, 1);
  assert.equal(existsSync(path.join(root, ".quorum", "proposed", "line-cap.md")), false);
  const second = recordFailure(root, "line-cap");
  assert.equal(second.action, "proposed");
  assert.match(readFileSync(path.join(root, "team", "proposed", "line-cap.md"), "utf8"), /human applies/i);
  const trust = JSON.parse(readFileSync(path.join(root, ".quorum", "trust.json"), "utf8"));
  assert.equal(trust.rung, "sampling");
  assert.equal(trust.merge, "human");
  const lines = readFileSync(path.join(root, "team", "failures.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).engineer, "ada");
  assert.equal(readFileSync(path.join(root, "team", "failures.jsonl"), "utf8").includes("resolved"), false);
  assert.equal(readFileSync(path.join(root, ".quorum", "failures.json"), "utf8").includes("resolved"), false);
});

test("status prints blocked and landed without creating .quorum or listing claims", () => {
  const root = tempRoot();
  const idle = quorumStatus(root);
  assert.match(idle, /blocked: 0/);
  assert.match(idle, /landed: 0/);
  assert.match(idle, /active: none/);
  assert.equal(idle.includes("engineer:"), false);
  assert.equal(idle.includes("claims"), false);
  assert.equal(idle.includes("merge:"), false);
  assert.equal(existsSync(path.join(root, ".quorum")), false);
  assert.match(sessionContext(root), /\/quorum:sync/);
  fileReport(root, "Waiting", "invoice-cents", "note", false);
  const inboxPath = path.join(root, ".quorum", "inbox.json");
  const inbox = JSON.parse(readFileSync(inboxPath, "utf8"));
  inbox[0].blocked = ["billing"];
  writeFileSync(inboxPath, `${JSON.stringify(inbox)}\n`);
  mkdirSync(path.join(root, "team"), { recursive: true });
  writeFileSync(
    path.join(root, "team", "landed.json"),
    `${JSON.stringify({ version: 1, features: { billing: { snapshot: "b" } } }, null, 2)}\n`,
  );
  mkdirSync(path.join(root, ".quorum"), { recursive: true });
  writeFileSync(path.join(root, ".quorum", "engineer.json"), `${JSON.stringify({ name: "ada" })}\n`);
  const job = openJob(root, { feature: "invoice", door: "two-way", intent: "Cents", check: "" });
  const active = quorumStatus(root);
  assert.match(active, /blocked: 1/);
  assert.match(active, /landed: 1/);
  assert.match(active, /engineer: ada/);
  assert.match(active, new RegExp(`merge: ${mergeStatus(root, job.id)[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(active.includes("claims"), false);
});
