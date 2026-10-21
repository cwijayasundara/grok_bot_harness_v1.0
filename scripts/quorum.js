#!/usr/bin/env node
/**
 * Deterministic core of Quorum, from Lauren Tan's account as filed on Postgrok.
 * Skills stay markdown workflow. This script is the part that must not be prose:
 * feature-directory lint, the buffer, a frozen intent snapshot, and a verify trace.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPECIFIER = /(?:\bfrom\s+|require\(\s*|import\(\s*|import\s+)['"]([^'"]+)['"]/g;
const SLUG = /[^a-z0-9-]+/g;
const SNAPSHOT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FEATURE_SLUG = /^[a-z0-9-]+$/;
const BLOCKED_SHELL = /\bgit\s+merge(?!-)\b|\bgit\s+push\b|\bgit\s+rebase\b|\bgh\s+pr\s+merge\b/;
const MODEL_DENIED = new Set(["land", "lead-ack", "claim", "tree-add", "tree-remove"]);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function quorumDir(root) {
  const dir = path.join(root, ".quorum");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function lineCount(text) {
  let count = text.split("\n").length - 1;
  if (text && !text.endsWith("\n")) count += 1;
  return count;
}

function walkScripts(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkScripts(full, out);
    else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) out.push(full);
  }
  return out;
}

function otherFeature(file, featuresDir, specifier) {
  const current = path.relative(featuresDir, file).split(path.sep)[0];
  let target = null;
  if (specifier.startsWith("features/")) {
    target = specifier.split("/")[1] || null;
  } else if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(file), specifier);
    const rel = path.relative(featuresDir, resolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) target = rel.split(path.sep)[0];
  }
  if (!target || target === current) return null;
  return { current, target, specifier };
}

export function lintTree(root, lineCap = 80) {
  const featuresDir = path.join(root, "features");
  if (!existsSync(featuresDir)) return [];
  const findings = [];
  const files = walkScripts(featuresDir).sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const relative = relativePosix(root, file);
    const count = lineCount(text);
    if (count > lineCap) {
      findings.push({ path: relative, rule: "line-cap", detail: `${count} lines exceeds ${lineCap}` });
    }
    SPECIFIER.lastIndex = 0;
    for (const match of text.matchAll(SPECIFIER)) {
      const hit = otherFeature(file, featuresDir, match[1]);
      if (!hit) continue;
      findings.push({
        path: relative,
        rule: "cross-feature-import",
        detail: `imports ${hit.specifier} from features/${hit.current}`,
      });
    }
  }
  return findings;
}

function slug(signature) {
  return signature.trim().toLowerCase().replace(SLUG, "-").replace(/^-+|-+$/g, "");
}

function proposalText(signature) {
  return `# Proposed constraint: ${signature}\n\nThe same shortcut showed up twice. Amend the environment: a lint, a type, or a skill.\nA human applies it in the target repo. This file is not a switch the model can flip.\n`;
}

export function recordFailure(root, signature) {
  const kitchen = readKitchen(root);
  let engineerName = "";
  if (kitchen) {
    const engineer = readJson(path.join(root, ".quorum", "engineer.json"), null);
    if (!engineer || typeof engineer.name !== "string" || !engineer.name) {
      throw new Error("engineer name is missing");
    }
    engineerName = engineer.name;
  }
  const file = path.join(quorumDir(root), "failures.json");
  const rows = readJson(file, []);
  let row = rows.find((item) => item.signature === signature);
  if (!row) {
    row = { signature, count: 0, status: "noted" };
    rows.push(row);
  }
  row.count += 1;
  let threshold = row.count;
  if (kitchen) {
    const jsonl = path.join(root, "team", "failures.jsonl");
    mkdirSync(path.dirname(jsonl), { recursive: true });
    appendFileSync(jsonl, `${JSON.stringify({ signature, engineer: engineerName, at: new Date().toISOString() })}\n`);
    threshold = readFileSync(jsonl, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((item) => item.signature === signature).length;
  }
  let action = "noted";
  if (threshold >= 2) {
    const proposal = path.join(quorumDir(root), "proposed", `${slug(signature)}.md`);
    mkdirSync(path.dirname(proposal), { recursive: true });
    const text = proposalText(signature);
    writeFileSync(proposal, text);
    if (kitchen) {
      const shared = path.join(root, "team", "proposed", `${slug(signature)}.md`);
      mkdirSync(path.dirname(shared), { recursive: true });
      writeFileSync(shared, text);
    }
    row.status = "proposed";
    action = "proposed";
    writeTrust(root, "sampling");
  }
  writeJson(file, rows);
  return { action, signature, count: row.count };
}

export function readTrust(root) {
  return readJson(path.join(root, ".quorum", "trust.json"), { rung: "verification", merge: "human" });
}

function writeTrust(root, rung) {
  writeJson(path.join(quorumDir(root), "trust.json"), { rung, merge: "human" });
}

function appendDoc(root, name, line) {
  const file = path.join(quorumDir(root), name);
  const prior = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${prior}${line}`);
}

export function addRow(root, summary, signature, source) {
  const file = path.join(quorumDir(root), "buffer.json");
  const rows = readJson(file, []);
  const id = randomUUID().replaceAll("-", "").slice(0, 8);
  rows.push({ id, summary, signature, source });
  writeJson(file, rows);
  appendDoc(root, "buffer.md", `- ${id} ${signature}: ${summary} (${source})\n`);
  return id;
}

export function normalizeRow(row) {
  const next = { ...row };
  if (!Array.isArray(next.depends_on)) next.depends_on = [];
  return next;
}

function rejectsSliceFields(options) {
  if (!options || typeof options !== "object") return false;
  if (Array.isArray(options.depends_on) ? options.depends_on.length > 0 : Boolean(options.depends_on)) return true;
  if (options.snapshot !== undefined) return true;
  if (options.note !== undefined) return true;
  if (options.check !== undefined) return true;
  return false;
}

function placedRow(id, summary, signature, source, options = {}) {
  if (rejectsSliceFields(options)) throw new Error("slice rows are filed by note-sync");
  const feature = options.feature ? String(options.feature) : "";
  const door = options.door ? String(options.door) : "";
  if (door && door !== "two-way" && door !== "one-way") {
    throw new Error("door must be two-way or one-way");
  }
  const row = { id, summary, signature, source };
  if (feature) row.feature = feature;
  if (door) row.door = door;
  return row;
}

export function fileReport(root, summary, signature, source, confirmed, options = {}) {
  if (rejectsSliceFields(options)) throw new Error("slice rows are filed by note-sync");
  const id = randomUUID().replaceAll("-", "").slice(0, 8);
  const row = placedRow(id, summary, signature, source, options);
  if (!confirmed) {
    const file = path.join(quorumDir(root), "inbox.json");
    const rows = readJson(file, []);
    rows.push({ ...row, confirmed: false });
    writeJson(file, rows);
    return { id, held: true };
  }
  const buffer = path.join(quorumDir(root), "buffer.json");
  const rows = readJson(buffer, []);
  rows.push(row);
  writeJson(buffer, rows);
  const featureNote = row.feature ? ` [${row.feature}]` : "";
  appendDoc(root, "buffer.md", `- ${id} ${signature}${featureNote}: ${summary} (${source})\n`);
  return { id, held: false };
}

export function intakeFile(root, file) {
  const orders = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(orders)) throw new Error("intake file must be a JSON array");
  for (const order of orders) {
    if (
      order &&
      (Object.hasOwn(order, "depends_on") ||
        Object.hasOwn(order, "check") ||
        Object.hasOwn(order, "note") ||
        Object.hasOwn(order, "snapshot"))
    ) {
      throw new Error("slice rows are filed by note-sync");
    }
  }
  return orders.map((order) =>
    fileReport(root, order.summary, order.signature, order.source || "intake", Boolean(order.confirmed), {
      feature: order.feature,
      door: order.door,
    }),
  );
}

export function addCorrection(root, note, signature) {
  appendDoc(root, "corrections.md", `- ${note}\n`);
  if (!signature) return { action: "logged" };
  return recordFailure(root, signature);
}

export function addSample(root, note) {
  appendDoc(root, "samples.md", `- ${note}\n`);
  return readTrust(root);
}

export function initCheck(root, feature) {
  const dir = path.join(root, "features", feature);
  mkdirSync(dir, { recursive: true });
  const checkFile = path.join(dir, "check.js");
  const note = path.join(dir, "VERIFY.md");
  let created = false;
  if (!existsSync(checkFile)) {
    writeFileSync(
      checkFile,
      `import assert from "node:assert/strict";\nimport * as feature from "./feature.js";\n\nassert.ok(feature);\n`,
    );
    created = true;
  }
  if (!existsSync(note)) {
    writeFileSync(
      note,
      `# Verify ${feature}\n\nRun \`node features/${feature}/check.js\` from the repository root.\nThe check must fail when the feature is wrong. Do not change this file to match a broken feature.\n`,
    );
  }
  return { check: `features/${feature}/check.js`, created };
}

export function assign(root) {
  const rows = readJson(path.join(root, ".quorum", "buffer.json"), []);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.signature)) grouped.set(row.signature, []);
    grouped.get(row.signature).push(row.id);
  }
  return [...grouped.entries()].map(([signature, rowIds]) => ({ signature, rowIds }));
}

export function openJob(root, fields) {
  const feature = fields.feature;
  const door = fields.door;
  const intent = fields.intent;
  const check = fields.check ?? "";
  const dependsOn = Array.isArray(fields.depends_on) ? fields.depends_on : [];
  const snapshotId = typeof fields.snapshot === "string" ? fields.snapshot : "";
  const signature = typeof fields.signature === "string" ? fields.signature : "";
  const note = typeof fields.note === "string" ? fields.note : "";
  let engineer = typeof fields.engineer === "string" ? fields.engineer : "";
  if (door !== "two-way" && door !== "one-way") {
    throw new Error("door must be two-way or one-way");
  }
  const existing = readJson(path.join(root, ".quorum", "active.json"), null);
  if (existing) {
    throw new Error(
      `job ${existing.id} is already active. Run job-close after merge-status is ready, or delete .quorum/active.json outside this session to abandon it.`,
    );
  }
  const kitchen = readKitchen(root);
  if (kitchen) {
    if (isPrimaryWorktree(root)) {
      throw new Error("integration checkout is the lead's. Open the job on an engineer worktree.");
    }
    const engineerFile = readJson(path.join(root, ".quorum", "engineer.json"), null);
    if (!engineerFile || typeof engineerFile.name !== "string" || !engineerFile.name) {
      throw new Error("engineer name is missing");
    }
    engineer = engineerFile.name;
    const claim = readClaims(root).claims[signature];
    if (!claim || claim.engineer !== engineer) throw new Error("lead has not claimed this signature");
    if (!fields.fromFile) throw new Error("team mode requires --from");
    if (!snapshotId) throw new Error("team mode requires a snapshot id");
    if (isNoopCheck(check) || BLOCKED_SHELL.test(check)) throw new Error("snapshot check is refused");
    if (check !== `node features/${feature}/check.js`) {
      throw new Error(`team mode requires node features/${feature}/check.js`);
    }
  }
  const unmet = unmetDeps(root, dependsOn);
  if (unmet.length > 0) throw new Error(`dependency has not merged: ${unmet.join(", ")}`);
  for (const rel of checkPaths(check)) {
    if (!existsSync(path.join(root, rel))) {
      throw new Error(`snapshot check file is missing: ${rel}. Create it before opening the job.`);
    }
  }
  const job = {
    id: randomUUID().replaceAll("-", "").slice(0, 8),
    snapshot: snapshotId,
    signature,
    feature,
    door,
    intent,
    check,
    depends_on: dependsOn,
    note,
    engineer,
    closed: false,
  };
  const dir = quorumDir(root);
  writeJson(path.join(dir, "jobs", `${job.id}.json`), job);
  writeJson(path.join(dir, "active.json"), job);
  const snapshot = [
    "---",
    `id: ${job.id}`,
    `snapshot: ${job.snapshot}`,
    `signature: ${job.signature}`,
    `feature: ${job.feature}`,
    `door: ${job.door}`,
    `depends_on: ${JSON.stringify(job.depends_on)}`,
    `check: ${JSON.stringify(job.check)}`,
    `note: ${job.note}`,
    "---",
    "",
    job.intent,
    "",
  ].join("\n");
  mkdirSync(path.join(dir, "snapshots"), { recursive: true });
  writeFileSync(path.join(dir, "snapshots", `${job.id}.md`), snapshot);
  return job;
}

export function writeTrace(root, jobId, passed, extra = {}) {
  const payload = { job_id: jobId, passed, ...extra };
  writeJson(path.join(quorumDir(root), "traces", "latest.json"), payload);
  return payload;
}

export function listScenarios(root, feature) {
  const dir = path.join(root, "features", feature, "swarm");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => path.join(dir, name));
}

export function swarmVerdict(sessions) {
  const passed = sessions.length > 0 && sessions.every((session) => session.passed === true);
  return { passed, sessions };
}

export function writeSwarmTrace(root, jobId, sessions) {
  const verdict = swarmVerdict(sessions);
  const payload = { job_id: jobId, passed: verdict.passed, count: sessions.length, sessions };
  writeJson(path.join(quorumDir(root), "traces", "swarm.json"), payload);
  return payload;
}

function swarmFresh(root, jobId) {
  const trace = readJson(path.join(root, ".quorum", "traces", "swarm.json"), null);
  return Boolean(trace && trace.job_id === jobId && trace.passed === true);
}

export function mergeStatus(root, jobId) {
  const job = readJson(path.join(root, ".quorum", "jobs", `${jobId}.json`), null);
  if (!job) return [false, "job is missing"];
  const dependsOn = Array.isArray(job.depends_on) ? job.depends_on : [];
  if (unmetDeps(root, dependsOn).length > 0) return [false, "dependency has not merged"];
  if (job.door === "one-way" && !job.check) return [false, "one-way door has no reversible check"];
  const trace = readJson(path.join(root, ".quorum", "traces", "latest.json"), null);
  if (!trace || trace.job_id !== jobId || trace.passed !== true) return [false, "no fresh passing verify trace"];
  if (existsSync(path.join(root, "team", "check.js")) && trace.team_exit !== 0) {
    return [false, "no fresh passing verify trace"];
  }
  if (listScenarios(root, job.feature).length > 0 && !swarmFresh(root, jobId)) {
    return [false, "no fresh passing playwright swarm trace"];
  }
  const snapshot = typeof job.snapshot === "string" ? job.snapshot : "";
  if (
    readKitchen(root) &&
    job.door === "one-way" &&
    snapshot &&
    !existsSync(path.join(root, "team", "acks", `${snapshot}.json`))
  ) {
    return [false, "one-way door stops for the lead"];
  }
  const trust = readTrust(root);
  const sampling = trust.rung === "sampling" ? "; trust rung is sampling" : "";
  return [true, `ready for human merge${sampling}`];
}

export function stopDecision(root, stopHookActive) {
  if (stopHookActive) return null;
  const state = path.join(root, ".quorum");
  const active = readJson(path.join(state, "active.json"), null);
  if (!active) return null;
  if (active.door === "one-way" && !active.check) {
    return {
      decision: "block",
      reason: "One-way door has no reversible check. The merge helper refuses.",
    };
  }
  const trace = readJson(path.join(state, "traces", "latest.json"), null);
  const fresh = trace && trace.job_id === active.id && trace.passed === true;
  if (!fresh) {
    return {
      decision: "block",
      reason:
        'Active job has no fresh passing verify trace. Run node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" verify --root ., then stop.',
    };
  }
  if (listScenarios(root, active.feature).length > 0 && !swarmFresh(root, active.id)) {
    return {
      decision: "block",
      reason:
        'Active job has scenarios but no fresh passing Playwright swarm trace. Run node "${CLAUDE_PLUGIN_ROOT}/scripts/quorum.js" swarm --root ., then stop.',
    };
  }
  return null;
}

export function isNoopCheck(command) {
  const text = String(command).trim();
  if (!text) return false;
  if (/process\.exit\(\s*0\s*\)/.test(text)) return true;
  return /^(true|false|:|exit\s+0)$/.test(text);
}

function isNoopBody(text) {
  return /^(?:process\.exit\(\s*0\s*\);?|true|false|:|exit\s+0)$/.test(String(text).trim());
}

export function checkPaths(command) {
  return String(command).match(/features\/[A-Za-z0-9_./-]+/g) || [];
}

export function readLineCap(root) {
  const stored = readJson(path.join(root, ".quorum", "lint.json"), null);
  const value = stored && Number(stored.lineCap);
  if (!Number.isInteger(value) || value < 1) return 80;
  return value;
}

function writeLineCap(root, lineCap) {
  writeJson(path.join(quorumDir(root), "lint.json"), { lineCap });
}

function runCheck(root, command, timeoutMs) {
  if (!command.trim()) return { exitCode: null, refused: false, timedOut: false };
  if (BLOCKED_SHELL.test(command) || isNoopCheck(command)) return { exitCode: null, refused: true, timedOut: false };
  const result = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: timeoutMs });
  return { exitCode: result.status, refused: false, timedOut: result.error?.code === "ETIMEDOUT" };
}

export function runVerify(root, lineCap = 80, checkTimeoutMs = 300000) {
  const findings = lintTree(root, lineCap);
  writeLineCap(root, lineCap);
  const active = readJson(path.join(root, ".quorum", "active.json"), null);
  const jobId = active ? active.id : "unscoped";
  const check = active && typeof active.check === "string" ? active.check : "";
  const teamPath = path.join(root, "team", "check.js");
  const teamExists = existsSync(teamPath);
  let teamExit = null;
  let teamRefused = false;
  let teamTimedOut = false;
  if (teamExists) {
    const body = readFileSync(teamPath, "utf8");
    if (isNoopBody(body)) teamRefused = true;
    else {
      const outcome = runCheck(root, "node team/check.js", checkTimeoutMs);
      teamExit = outcome.exitCode;
      teamRefused = outcome.refused;
      teamTimedOut = outcome.timedOut;
    }
  }
  const runSnapshot = check.trim() !== "" && check !== "node team/check.js";
  let checkExit = null;
  let checkRefused = false;
  let checkTimedOut = false;
  if (runSnapshot) {
    const outcome = runCheck(root, check, checkTimeoutMs);
    checkExit = outcome.exitCode;
    checkRefused = outcome.refused;
    checkTimedOut = outcome.timedOut;
  }
  let passed = findings.length === 0;
  if (teamExists) passed = passed && teamExit === 0 && !teamRefused;
  if (runSnapshot) passed = passed && checkExit === 0 && !checkRefused;
  if (!teamExists && !runSnapshot) passed = false;
  const trace = writeTrace(root, jobId, passed, {
    lint_clean: findings.length === 0,
    team_exit: teamExit,
    check_exit: checkExit,
    timed_out: teamTimedOut || checkTimedOut,
  });
  return { trace, findings };
}

function rowMatchesClosedJob(row, job) {
  const signature = typeof job.signature === "string" ? job.signature : "";
  const snapshot = typeof job.snapshot === "string" ? job.snapshot : "";
  const rowSnapshot = typeof row.snapshot === "string" ? row.snapshot : "";
  const bySignature = signature !== "" && row.signature === signature;
  const bySnapshot = snapshot !== "" && rowSnapshot !== "" && rowSnapshot === snapshot;
  return bySignature || bySnapshot;
}

export function closeJob(root) {
  const activePath = path.join(root, ".quorum", "active.json");
  const active = readJson(activePath, null);
  if (!active) return { closed: false, reason: "job is missing" };
  const [allowed, reason] = mergeStatus(root, active.id);
  if (!allowed) return { closed: false, reason };
  const jobPath = path.join(root, ".quorum", "jobs", `${active.id}.json`);
  const job = readJson(jobPath, { ...active });
  job.closed = true;
  writeJson(jobPath, job);
  for (const name of ["inbox.json", "buffer.json"]) {
    const file = path.join(root, ".quorum", name);
    if (!existsSync(file)) continue;
    const rows = readJson(file, []);
    if (!Array.isArray(rows)) continue;
    writeJson(file, rows.filter((row) => !rowMatchesClosedJob(row, job)));
  }
  unlinkSync(activePath);
  return { closed: true, id: active.id };
}

function gitResult(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function readKitchen(root) {
  const file = path.join(root, "team", "kitchen.json");
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.version !== 1) throw new Error("team/kitchen.json version must be 1");
  if (typeof data.integrationBranch !== "string" || !data.integrationBranch) {
    throw new Error("team/kitchen.json requires integrationBranch");
  }
  if (typeof data.treesDir !== "string" || !data.treesDir) throw new Error("team/kitchen.json requires treesDir");
  return data;
}

function readClaims(root) {
  const file = path.join(root, "team", "claims.json");
  if (!existsSync(file)) return { version: 1, claims: {} };
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.version !== 1) throw new Error("team/claims.json version must be 1");
  if (!data.claims || typeof data.claims !== "object") throw new Error("team/claims.json claims must be an object");
  return data;
}

export function readLanded(root) {
  const file = path.join(root, "team", "landed.json");
  if (!existsSync(file)) return { version: 1, features: {} };
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.version !== 1) throw new Error("team/landed.json version must be 1");
  if (!data.features || typeof data.features !== "object") throw new Error("team/landed.json features must be an object");
  return data;
}

export function unmetDeps(root, dependsOn) {
  const list = Array.isArray(dependsOn) ? dependsOn : [];
  const features = readLanded(root).features || {};
  return list.filter((item) => !Object.hasOwn(features, item));
}

function isPrimaryWorktree(root) {
  const gitPath = path.join(root, ".git");
  if (existsSync(gitPath) && statSync(gitPath).isDirectory()) return true;
  const dir = gitResult(root, ["rev-parse", "--git-dir"]);
  const common = gitResult(root, ["rev-parse", "--git-common-dir"]);
  if (dir.status !== 0 || common.status !== 0) return true;
  return path.resolve(root, dir.stdout.trim()) === path.resolve(root, common.stdout.trim());
}

function primaryCheckout(root) {
  const common = gitResult(root, ["rev-parse", "--git-common-dir"]);
  if (common.status !== 0) throw new Error(common.stderr.trim() || "not a git checkout");
  return path.resolve(root, path.dirname(common.stdout.trim()));
}

function walkNotes(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkNotes(full, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function listSliceFiles(root) {
  const notes = path.join(root, "notes");
  return walkNotes(notes)
    .filter((file) => path.relative(notes, file).includes(path.sep))
    .sort((left, right) => left.localeCompare(right));
}

function firstLine(body) {
  const line = String(body)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return (line || "").slice(0, 200);
}

function parseSliceFile(root, file) {
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const rel = relativePosix(root, file);
  const featureFromName = path.basename(file, ".md");
  const errors = [];
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const empty = {
    rel,
    featureFromName,
    errors,
    id: "",
    signature: "",
    feature: featureFromName,
    door: "",
    depends_on: [],
    check: "",
    body: "",
  };
  if (!match) {
    errors.push({ field: "front-matter", reason: "missing front matter" });
    return empty;
  }
  const raw = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 1) {
      errors.push({ field: "front-matter", reason: "bad line" });
      continue;
    }
    raw[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const id = raw.id || "";
  const signature = raw.signature || "";
  const feature = raw.feature || "";
  const door = raw.door || "";
  if (!SNAPSHOT_ID.test(id)) errors.push({ field: "id", reason: "must match ^[a-z0-9][a-z0-9-]{0,63}$" });
  if (!FEATURE_SLUG.test(signature) || slug(signature) !== signature) {
    errors.push({ field: "signature", reason: "must be a slug" });
  }
  if (!FEATURE_SLUG.test(feature)) errors.push({ field: "feature", reason: "must be a slug" });
  if (feature && feature !== featureFromName) errors.push({ field: "feature", reason: "file name must match feature" });
  if (door !== "two-way" && door !== "one-way") errors.push({ field: "door", reason: "must be two-way or one-way" });
  let depends = [];
  if (raw.depends_on === undefined) errors.push({ field: "depends_on", reason: "required" });
  else {
    try {
      const parsed = JSON.parse(raw.depends_on);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !FEATURE_SLUG.test(item))) {
        errors.push({ field: "depends_on", reason: "must be a one-line JSON array of feature slugs" });
      } else {
        depends = parsed;
        if (feature && depends.includes(feature)) errors.push({ field: "depends_on", reason: "self is illegal" });
      }
    } catch {
      errors.push({ field: "depends_on", reason: "must be a one-line JSON array of feature slugs" });
    }
  }
  let check = "";
  if (raw.check === undefined) errors.push({ field: "check", reason: "required" });
  else {
    try {
      const parsed = JSON.parse(raw.check);
      if (typeof parsed !== "string") errors.push({ field: "check", reason: "must be a JSON string" });
      else {
        check = parsed;
        if (isNoopCheck(check) || BLOCKED_SHELL.test(check)) errors.push({ field: "check", reason: "refused" });
        else if (feature && check !== `node features/${feature}/check.js`) {
          errors.push({ field: "check", reason: `must be node features/${feature}/check.js` });
        }
      }
    } catch {
      errors.push({ field: "check", reason: "must be a JSON string" });
    }
  }
  return { rel, featureFromName, errors, id, signature, feature, door, depends_on: depends, check, body: match[2] };
}

function findCycles(graph) {
  const color = new Map();
  const cycles = [];
  function visit(node, stack) {
    color.set(node, "gray");
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (color.get(next) === "gray") {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next]);
      } else if (color.get(next) !== "black") visit(next, stack);
    }
    stack.pop();
    color.set(node, "black");
  }
  for (const node of graph.keys()) {
    if (!color.has(node)) visit(node, []);
  }
  return cycles;
}

function loadSlices(root) {
  return listSliceFiles(root).map((file) => parseSliceFile(root, file));
}

export function noteCheck(root) {
  const slices = loadSlices(root);
  const errors = [];
  const byFeature = new Map();
  const bySignature = new Map();
  for (const slice of slices) {
    if (!byFeature.has(slice.featureFromName)) byFeature.set(slice.featureFromName, []);
    byFeature.get(slice.featureFromName).push(slice);
    if (slice.signature) {
      if (!bySignature.has(slice.signature)) bySignature.set(slice.signature, []);
      bySignature.get(slice.signature).push(slice);
    }
  }
  for (const [feature, group] of byFeature) {
    if (group.length < 2) continue;
    for (const slice of group) {
      errors.push({ path: slice.rel, field: "feature", reason: `more than one notes/**/${feature}.md` });
    }
  }
  for (const [signature, group] of bySignature) {
    if (group.length < 2) continue;
    for (const slice of group) {
      errors.push({ path: slice.rel, field: "signature", reason: `duplicate signature ${signature}` });
    }
  }
  const badPaths = new Set(errors.map((item) => item.path));
  for (const slice of slices) {
    if (badPaths.has(slice.rel)) continue;
    for (const error of slice.errors) errors.push({ path: slice.rel, field: error.field, reason: error.reason });
  }
  const clean = slices.filter((slice) => !errors.some((error) => error.path === slice.rel));
  const names = new Set(clean.map((slice) => slice.feature));
  const graph = new Map(clean.map((slice) => [slice.feature, slice.depends_on.filter((item) => names.has(item))]));
  for (const cycle of findCycles(graph)) {
    const reason = `cycle ${cycle.join(" -> ")}`;
    for (const feature of new Set(cycle)) {
      const slice = clean.find((item) => item.feature === feature);
      if (slice) errors.push({ path: slice.rel, field: "depends_on", reason });
    }
  }
  return errors;
}

function snapshotOf(row) {
  return typeof row.snapshot === "string" ? row.snapshot : "";
}

function readRows(root, name) {
  const file = path.join(root, ".quorum", name);
  if (!existsSync(file)) return [];
  const rows = readJson(file, []);
  return Array.isArray(rows) ? rows : [];
}

function closedSnapshot(root, snapshot) {
  const dir = path.join(root, ".quorum", "jobs");
  if (!snapshot || !existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const job = readJson(path.join(dir, name), null);
    if (job && job.snapshot === snapshot && job.closed === true) return true;
  }
  return false;
}

function newRowId() {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

export function noteSync(root) {
  const errors = noteCheck(root);
  const messages = [];
  const slices = loadSlices(root);
  const bad = new Set(errors.map((error) => error.path));
  const valid = slices.filter((slice) => !bad.has(slice.rel));
  const quorumExists = existsSync(path.join(root, ".quorum"));
  if (!quorumExists && valid.length === 0) {
    return { inbox: 0, buffer: 0, skipped: slices.length, messages, errors };
  }
  let inbox = readRows(root, "inbox.json");
  let buffer = readRows(root, "buffer.json");
  let dirty = false;
  let skipped = slices.length - valid.length;
  const touch = () => {
    dirty = true;
  };
  const dropSnapshot = (list, snapshot) => list.filter((row) => snapshotOf(row) !== snapshot);
  for (const slice of valid) {
    const landed = readLanded(root).features[slice.feature];
    const consumed = (landed && landed.snapshot === slice.id) || closedSnapshot(root, slice.id);
    if (consumed) {
      const nextInbox = dropSnapshot(inbox, slice.id);
      const nextBuffer = dropSnapshot(buffer, slice.id);
      if (nextInbox.length !== inbox.length || nextBuffer.length !== buffer.length) touch();
      inbox = nextInbox;
      buffer = nextBuffer;
      continue;
    }
    const signatureOnly =
      buffer.some((row) => row.signature === slice.signature && snapshotOf(row) === "") &&
      !buffer.some((row) => snapshotOf(row) === slice.id);
    if (signatureOnly) {
      messages.push(`skipped ${slice.signature}: buffer row has no snapshot`);
      skipped += 1;
      continue;
    }
    const unmet = unmetDeps(root, slice.depends_on);
    if (unmet.length > 0) {
      const nextBuffer = dropSnapshot(buffer, slice.id);
      if (nextBuffer.length !== buffer.length) touch();
      buffer = nextBuffer;
      const existing = inbox.find((row) => snapshotOf(row) === slice.id);
      const row = {
        id: existing ? existing.id : newRowId(),
        summary: firstLine(slice.body),
        signature: slice.signature,
        source: "note",
        feature: slice.feature,
        door: slice.door,
        depends_on: slice.depends_on,
        blocked: unmet,
        check: slice.check,
        note: slice.rel,
        snapshot: slice.id,
        confirmed: false,
      };
      inbox = inbox.filter((item) => snapshotOf(item) !== slice.id);
      inbox.push(row);
      touch();
      continue;
    }
    const already = buffer.some((row) => snapshotOf(row) === slice.id);
    const nextInbox = dropSnapshot(inbox, slice.id);
    if (nextInbox.length !== inbox.length) touch();
    inbox = nextInbox;
    if (!already) {
      buffer.push({
        id: newRowId(),
        summary: firstLine(slice.body),
        signature: slice.signature,
        source: "note",
        feature: slice.feature,
        door: slice.door,
        depends_on: slice.depends_on,
        check: slice.check,
        note: slice.rel,
        snapshot: slice.id,
      });
      touch();
    }
  }
  const live = new Set(slices.map((slice) => slice.id).filter(Boolean));
  const active = readJson(path.join(root, ".quorum", "active.json"), null);
  const activeId = active && typeof active.snapshot === "string" ? active.snapshot : "";
  const keepVanished = (row) => {
    const snapshot = snapshotOf(row);
    if (!snapshot || live.has(snapshot)) return true;
    return snapshot === activeId;
  };
  const vanishedInbox = inbox.filter(keepVanished);
  const vanishedBuffer = buffer.filter(keepVanished);
  if (vanishedInbox.length !== inbox.length || vanishedBuffer.length !== buffer.length) touch();
  inbox = vanishedInbox;
  buffer = vanishedBuffer;
  if (dirty) {
    writeJson(path.join(root, ".quorum", "inbox.json"), inbox);
    writeJson(path.join(root, ".quorum", "buffer.json"), buffer);
  }
  return { inbox: inbox.length, buffer: buffer.length, skipped, messages, errors };
}

function treesDirOf(root, kitchen) {
  const primary = primaryCheckout(root);
  const treesDir = path.resolve(primary, kitchen.treesDir);
  const relative = path.relative(primary, treesDir);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("treesDir must resolve outside the primary worktree");
  }
  return { primary, treesDir };
}

function worktreeBlocks(porcelain) {
  const blocks = [];
  let current = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

export function treeAdd(root, name) {
  if (!FEATURE_SLUG.test(name)) throw new Error("engineer name must match ^[a-z0-9-]+$");
  const kitchen = readKitchen(root);
  if (!kitchen) throw new Error("team/kitchen.json is missing");
  const { primary, treesDir } = treesDirOf(root, kitchen);
  const abs = path.join(treesDir, name);
  if (existsSync(abs)) throw new Error(`${abs} already exists`);
  const listed = gitResult(primary, ["worktree", "list", "--porcelain"]);
  if (listed.status !== 0) throw new Error(listed.stderr.trim() || "git worktree list failed");
  const branch = `eng/${name}`;
  if (listed.stdout.split("\n").includes(`branch refs/heads/${branch}`)) {
    throw new Error(`${branch} is already checked out`);
  }
  mkdirSync(treesDir, { recursive: true });
  const exists = gitResult(primary, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const added =
    exists.status === 0
      ? gitResult(primary, ["worktree", "add", abs, branch])
      : gitResult(primary, ["worktree", "add", "-b", branch, abs, kitchen.integrationBranch]);
  if (added.status !== 0) throw new Error(added.stderr.trim() || "git worktree add failed");
  const engineerFile = path.join(abs, ".quorum", "engineer.json");
  if (!existsSync(engineerFile)) writeJson(engineerFile, { name });
  return { path: abs, branch };
}

export function treeList(root) {
  const kitchen = readKitchen(root);
  if (!kitchen) throw new Error("team/kitchen.json is missing");
  const { primary, treesDir } = treesDirOf(root, kitchen);
  const listed = gitResult(primary, ["worktree", "list", "--porcelain"]);
  if (listed.status !== 0) throw new Error(listed.stderr.trim() || "git worktree list failed");
  const kept = worktreeBlocks(listed.stdout).filter((block) => {
    const line = block.find((item) => item.startsWith("worktree "));
    if (!line) return false;
    const worktree = line.slice("worktree ".length);
    const relative = path.relative(treesDir, worktree);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return kept.map((block) => block.join("\n")).join("\n\n");
}

export function treeRemove(root, name) {
  if (!FEATURE_SLUG.test(name)) throw new Error("engineer name must match ^[a-z0-9-]+$");
  const kitchen = readKitchen(root);
  if (!kitchen) throw new Error("team/kitchen.json is missing");
  const { primary, treesDir } = treesDirOf(root, kitchen);
  const abs = path.join(treesDir, name);
  if (existsSync(path.join(abs, ".quorum", "active.json"))) {
    throw new Error("active.json exists");
  }
  const removed = gitResult(primary, ["worktree", "remove", abs]);
  if (removed.status !== 0) throw new Error(removed.stderr.trim() || "git worktree remove failed");
  return { path: abs, branch: `eng/${name}` };
}

export function claimSignature(root, { signature, engineer, snapshot }) {
  if (!readKitchen(root)) throw new Error("team/kitchen.json is missing");
  if (!FEATURE_SLUG.test(signature)) throw new Error("signature must be a slug");
  if (!FEATURE_SLUG.test(engineer)) throw new Error("engineer name must match ^[a-z0-9-]+$");
  const slices = loadSlices(root);
  const matches = slices.filter((slice) => slice.signature === signature);
  if (matches.length !== 1) throw new Error("claim needs exactly one slice for this signature");
  const feature = matches[0].featureFromName;
  if (slices.filter((slice) => slice.featureFromName === feature).length !== 1) {
    throw new Error("more than one slice file for this feature");
  }
  if (matches[0].errors.length > 0) {
    throw new Error(matches[0].errors.map((error) => `${error.field}: ${error.reason}`).join("; "));
  }
  const claims = readClaims(root);
  const current = claims.claims[signature];
  if (current && current.engineer !== engineer) throw new Error("signature is claimed by someone else");
  for (const [key, claim] of Object.entries(claims.claims)) {
    if (key !== signature && claim.engineer === engineer) throw new Error("engineer already has an open claim");
  }
  claims.claims[signature] = { engineer, snapshot: snapshot || matches[0].id };
  writeJson(path.join(root, "team", "claims.json"), { version: 1, claims: claims.claims });
  return claims.claims[signature];
}

async function runLeadChecks(root, slice, checkTimeoutMs) {
  const findings = lintTree(root, readLineCap(root));
  if (findings.length > 0) {
    throw new Error(findings.map((item) => `${item.path}: ${item.rule}: ${item.detail}`).join("; "));
  }
  const teamPath = path.join(root, "team", "check.js");
  if (existsSync(teamPath)) {
    if (isNoopBody(readFileSync(teamPath, "utf8"))) throw new Error("team check is a noop");
    const team = runCheck(root, "node team/check.js", checkTimeoutMs);
    if (team.refused || team.exitCode !== 0) throw new Error("team check failed");
  }
  if (slice.check !== "node team/check.js") {
    const outcome = runCheck(root, slice.check, checkTimeoutMs);
    if (outcome.refused || outcome.exitCode !== 0) throw new Error("slice check failed");
  }
  const scenarios = listScenarios(root, slice.feature);
  return scenarios;
}

export async function leadAck(root, { snapshot, count = 1, checkTimeoutMs = 300000 }) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("count must be from 1 to 10");
  const slice = loadSlices(root).find((item) => item.id === snapshot && item.errors.length === 0);
  if (!slice) throw new Error("slice is missing");
  if (slice.door !== "one-way") throw new Error("two-way slices do not use lead-ack");
  const scenarios = await runLeadChecks(root, slice, checkTimeoutMs);
  if (scenarios.length > 0) {
    const { runPlaywrightSwarm } = await import("./playwright_swarm.js");
    const sessions = await runPlaywrightSwarm({ root, feature: slice.feature, scenarios, count, fuzz: 0, baseURL: "" });
    const trace = writeSwarmTrace(root, snapshot, sessions);
    if (!trace.passed) throw new Error("playwright swarm did not pass");
  }
  const head = gitResult(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0) throw new Error(head.stderr.trim() || "git rev-parse HEAD failed");
  const verifiedCommit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(verifiedCommit)) throw new Error("verifiedCommit must be 40 hex");
  const ack = {
    snapshot,
    feature: slice.feature,
    door: slice.door,
    verifiedCommit,
    ackedAt: new Date().toISOString().slice(0, 10),
  };
  writeJson(path.join(root, "team", "acks", `${snapshot}.json`), ack);
  return ack;
}

export function landFeature(root, { feature, snapshot, commit }) {
  if (!readKitchen(root)) throw new Error("team/kitchen.json is missing");
  if (!FEATURE_SLUG.test(feature)) throw new Error("feature must be a slug");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("commit must be 40 hex");
  const slices = loadSlices(root).filter((slice) => slice.featureFromName === feature);
  if (slices.length !== 1) throw new Error("exactly one slice file is required");
  const slice = slices[0];
  if (slice.errors.length > 0) throw new Error(slice.errors.map((error) => `${error.field}: ${error.reason}`).join("; "));
  if (slice.id !== snapshot || slice.feature !== feature) throw new Error("slice id, feature, and signature must match");
  const ancestor = gitResult(root, ["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (ancestor.status !== 0) throw new Error("commit is not an ancestor of HEAD");
  if (slice.door === "one-way") {
    const ack = readJson(path.join(root, "team", "acks", `${snapshot}.json`), null);
    if (!ack) throw new Error("ack file is missing");
    if (ack.snapshot !== snapshot || ack.feature !== feature || ack.door !== slice.door) {
      throw new Error("ack does not match the slice");
    }
    if (!/^[0-9a-f]{40}$/.test(ack.verifiedCommit)) throw new Error("verifiedCommit must be 40 hex");
    const verified = gitResult(root, ["merge-base", "--is-ancestor", ack.verifiedCommit, commit]);
    if (verified.status !== 0) throw new Error("verifiedCommit is not an ancestor of commit");
  }
  const landed = readLanded(root);
  landed.version = 1;
  landed.features[feature] = {
    snapshot,
    signature: slice.signature,
    commit,
    landedAt: new Date().toISOString().slice(0, 10),
  };
  writeJson(path.join(root, "team", "landed.json"), landed);
  const claimsPath = path.join(root, "team", "claims.json");
  if (existsSync(claimsPath)) {
    const claims = readClaims(root);
    delete claims.claims[slice.signature];
    writeJson(claimsPath, { version: 1, claims: claims.claims });
  }
  return landed.features[feature];
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else args._.push(token);
  }
  return args;
}

function touchedFeatures(payload) {
  const toolInput = payload.tool_input || {};
  const response = payload.tool_response;
  const candidates = [
    toolInput.file_path,
    toolInput.path,
    response && typeof response === "object" ? response.filePath : null,
  ];
  return candidates.some((candidate) => candidate && String(candidate).split(/[/\\]/).includes("features"));
}

const SHELL_JOIN = /[`;\n]|\$\(|\|\|?|&&|\s&\s|\s&$/;
const SHELL_EVAL = /\b(?:node\s+(?:-e|--eval)|(?:python3?|ruby|perl)\s+-e|osascript)\b|\bsed\s+-[^\n;]*\bi|\bperl\s+-i\b/;
const SHELL_WRITER = /\b(?:tee|rm|mv|cp|mkdir|touch|truncate|dd|install|ln|chmod|chown|Set-Content|Out-File|Add-Content|Remove-Item|New-Item)\b/i;
const REDIRECT = /(?:^|[\s;|&])(\d?>>?)\s*([^\s;|&]+)/g;

function pathParts(file) {
  return String(file).split(/[/\\]/).filter(Boolean);
}

function insideFeature(file, feature) {
  const parts = pathParts(file);
  const index = parts.lastIndexOf("features");
  return index >= 0 && parts[index + 1] === feature;
}

function pathInsideFeature(target, feature) {
  const normalized = String(target).replaceAll("\\", "/").replace(/^['"]|['"]$/g, "");
  return normalized === `features/${feature}` || normalized.startsWith(`features/${feature}/`) || normalized.includes(`/features/${feature}/`);
}

function redirectsOutside(command, feature) {
  REDIRECT.lastIndex = 0;
  for (const match of command.matchAll(REDIRECT)) {
    const target = match[2];
    if (target === "/dev/null" || target.startsWith("&")) continue;
    if (!pathInsideFeature(target, feature)) return true;
  }
  return false;
}

function writerOutside(command, feature) {
  if (!SHELL_WRITER.test(command)) return false;
  let sawInside = false;
  for (const token of command.split(/\s+/)) {
    const bare = token.replace(/^['"]|['"]$/g, "");
    if (!bare.includes("/") && !bare.startsWith(".")) continue;
    if (pathInsideFeature(bare, feature)) sawInside = true;
    else return true;
  }
  return !sawInside;
}

function shellTokens(command) {
  return String(command)
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function leadSubcommand(command) {
  const tokens = shellTokens(command);
  const index = tokens.findIndex((token) => token.endsWith("quorum.js"));
  if (index < 0) return null;
  let cursor = index + 1;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.startsWith("--")) {
      const next = tokens[cursor + 1];
      cursor += next !== undefined && !next.startsWith("-") ? 2 : 1;
      continue;
    }
    return token;
  }
  return null;
}

function shellDecision(root, command) {
  if (BLOCKED_SHELL.test(command)) {
    return deny("The human merges. git merge, git push, git rebase, and gh pr merge stay blocked.");
  }
  if (command.includes(".quorum")) {
    return deny("Quorum state is written by scripts/quorum.js. Do not edit .quorum/.");
  }
  const subcommand = leadSubcommand(command);
  if (subcommand && MODEL_DENIED.has(subcommand)) {
    return deny(`${subcommand} is a lead command. Run it from a terminal outside this session.`);
  }
  const active = readJson(path.join(root, ".quorum", "active.json"), null);
  if (!active) return null;
  if (SHELL_JOIN.test(command) || SHELL_EVAL.test(command)) {
    return deny(
      `Active job ${active.id} blocks shell eval, pipes, and command substitution. Edit features/${active.feature}/ with Write or Edit.`,
    );
  }
  if (redirectsOutside(command, active.feature) || writerOutside(command, active.feature)) {
    return deny(`Active job ${active.id} may write only features/${active.feature}/.`);
  }
  return null;
}

function quorumStatePath(file) {
  return pathParts(file).includes(".quorum");
}

function topKitchen(root, file) {
  const absolute = path.resolve(root, String(file));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const first = relative.split(path.sep).filter(Boolean)[0];
  return first === "notes" || first === "team";
}

export function quorumStatus(root) {
  const dir = path.join(root, ".quorum");
  const active = readJson(path.join(dir, "active.json"), null);
  const buffer = readJson(path.join(dir, "buffer.json"), []);
  const failures = readJson(path.join(dir, "failures.json"), []);
  const trace = readJson(path.join(dir, "traces", "latest.json"), null);
  const inbox = readJson(path.join(dir, "inbox.json"), []);
  const trust = readTrust(root);
  const blocked = Array.isArray(inbox) ? inbox.filter((row) => Array.isArray(row.blocked) && row.blocked.length > 0).length : 0;
  const landedFile = path.join(root, "team", "landed.json");
  const landed = existsSync(landedFile) ? Object.keys(readLanded(root).features || {}).length : 0;
  const engineer = readJson(path.join(dir, "engineer.json"), null);
  const lines = ["quorum"];
  lines.push(`trust: ${trust.rung} merge=${trust.merge}`);
  lines.push(`inbox: ${Array.isArray(inbox) ? inbox.length : 0}`);
  lines.push(`blocked: ${blocked}`);
  lines.push(`landed: ${landed}`);
  if (engineer && engineer.name) lines.push(`engineer: ${engineer.name}`);
  lines.push(active ? `active: ${active.id} feature=${active.feature} door=${active.door}` : "active: none");
  if (active) lines.push(`merge: ${mergeStatus(root, active.id)[1]}`);
  lines.push(`buffer: ${Array.isArray(buffer) ? buffer.length : 0}`);
  const open = Array.isArray(failures) ? failures.filter((row) => row.status !== "resolved").length : 0;
  lines.push(`failures: ${open} open`);
  lines.push(trace ? `trace: job ${trace.job_id} passed=${trace.passed}` : "trace: none");
  return lines.join("\n");
}

export function sessionContext(root) {
  return [
    "Quorum is on. The scanner files, the coordinator dispatches one worker per signature, one verifier returns the verdict, and the human samples and merges.",
    "Commands: /quorum:status, /quorum:sync, /quorum:job, /quorum:buffer, /quorum:verify, /quorum:constrain, /quorum:sample, /quorum:check, /quorum:corrections, /quorum:close.",
    "A green lint is not verification. The snapshot check must run the feature, and that check file stays frozen. An unconfirmed report stays in the inbox. Trust drops to sampling when a shortcut repeats. Merge stays with the human.",
    quorumStatus(root),
  ].join("\n");
}

export function promptContext(root) {
  const active = readJson(path.join(root, ".quorum", "active.json"), null);
  if (!active) return null;
  return `Active quorum job ${active.id} on features/${active.feature}/ (${active.door}). Do not merge. Finish only with a passing verify trace.`;
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function preToolDecision(root, payload) {
  const name = payload.tool_name || "";
  const input = payload.tool_input || {};
  if (name === "Bash" || name === "PowerShell") {
    return shellDecision(root, String(input.command || ""));
  }
  if (name === "Write" || name === "Edit" || name === "NotebookEdit") {
    const file = input.file_path || input.path || input.notebook_path;
    if (!file) return null;
    if (quorumStatePath(file)) {
      return deny("Quorum state is written by scripts/quorum.js. Do not edit .quorum/.");
    }
    const active = readJson(path.join(root, ".quorum", "active.json"), null);
    if (topKitchen(root, file) && !(active && insideFeature(file, active.feature))) {
      return deny("notes/ and team/ are the lead's. Do not edit them.");
    }
    if (active && checkPaths(active.check).some((rel) => String(file).split(/[/\\]/).join("/").endsWith(rel))) {
      return deny("The snapshot check is frozen. Do not rewrite it to match the code.");
    }
    if (active && !insideFeature(file, active.feature)) {
      return deny(`Active job ${active.id} may edit only features/${active.feature}/.`);
    }
  }
  return null;
}

function contextPayload(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function hookSession() {
  process.stdout.write(`${JSON.stringify(contextPayload("SessionStart", sessionContext(process.cwd())))}\n`);
  return 0;
}

function hookPrompt() {
  const text = promptContext(process.cwd());
  if (text) process.stdout.write(`${JSON.stringify(contextPayload("UserPromptSubmit", text))}\n`);
  return 0;
}

function hookPreTool() {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const decision = preToolDecision(process.cwd(), payload);
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
  return 0;
}

function hookStop() {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  if (payload.stop_hook_active === true) return 0;
  const decision = stopDecision(process.cwd(), false);
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
  return 0;
}

export function postEditDecision(root, payload) {
  if (!touchedFeatures(payload)) return null;
  const findings = lintTree(root, readLineCap(root));
  if (findings.length === 0) return null;
  const reason = findings.map((item) => `${item.path}: ${item.rule}: ${item.detail}`).join("; ");
  return { decision: "block", reason };
}

function hookPostEdit() {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const decision = postEditDecision(process.cwd(), payload);
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
  return 0;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  const root = path.resolve(args.root === undefined || args.root === true ? "." : String(args.root));

  if (MODEL_DENIED.has(command) && process.stdin.isTTY !== true) {
    process.stderr.write(`${command} requires a terminal\n`);
    return 2;
  }
  if (command === "hook") {
    if (args._[1] === "stop") return hookStop();
    if (args._[1] === "post-edit") return hookPostEdit();
    if (args._[1] === "session") return hookSession();
    if (args._[1] === "prompt") return hookPrompt();
    if (args._[1] === "pre-tool") return hookPreTool();
    process.stderr.write("hook expects session, prompt, pre-tool, stop, or post-edit\n");
    return 2;
  }
  if (command === "status") {
    process.stdout.write(`${quorumStatus(root)}\n`);
    return 0;
  }
  if (command === "swarm") {
    const count = args.count === undefined ? 1 : Number(args.count);
    const fuzz = args.fuzz === undefined ? 0 : Number(args.fuzz);
    const baseURL = args["base-url"] && args["base-url"] !== true ? String(args["base-url"]) : "";
    const { runPlaywrightSwarm } = await import("./playwright_swarm.js");
    const active = readJson(path.join(root, ".quorum", "active.json"), null);
    const feature = args.feature && args.feature !== true ? String(args.feature) : active?.feature;
    if (!feature) {
      process.stderr.write("swarm requires an active job or --feature\n");
      return 2;
    }
    const scenarios = listScenarios(root, feature);
    if (scenarios.length === 0) {
      process.stderr.write(`features/${feature}/swarm has no scenarios\n`);
      return 1;
    }
    try {
      const sessions = await runPlaywrightSwarm({ root, feature, scenarios, count, fuzz, baseURL });
      const jobId = active && active.feature === feature ? active.id : "unscoped";
      const trace = writeSwarmTrace(root, jobId, sessions);
      process.stdout.write(`${JSON.stringify({ job_id: trace.job_id, passed: trace.passed, count: trace.count })}\n`);
      return trace.passed ? 0 : 1;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
  }
  if (command === "verify") {
    const lineCap = args["line-cap"] === undefined ? readLineCap(root) : Number(args["line-cap"]);
    const timeoutSec = args["check-timeout"] === undefined ? 300 : Number(args["check-timeout"]);
    if (!Number.isInteger(lineCap) || lineCap < 1) {
      process.stderr.write("verify --line-cap expects a positive whole number\n");
      return 2;
    }
    if (!Number.isInteger(timeoutSec) || timeoutSec < 1) {
      process.stderr.write("verify --check-timeout expects whole seconds\n");
      return 2;
    }
    const { trace } = runVerify(root, lineCap, timeoutSec * 1000);
    process.stdout.write(`${JSON.stringify(trace)}\n`);
    return trace.passed ? 0 : 1;
  }
  if (command === "job-close") {
    const result = closeJob(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.closed ? 0 : 1;
  }
  if (command === "job-open") {
    try {
      const from = args.from && args.from !== true ? String(args.from) : "";
      let feature = args.feature && args.feature !== true ? String(args.feature) : "";
      let door = args.door && args.door !== true ? String(args.door) : "";
      let intent = args.intent && args.intent !== true ? String(args.intent) : "";
      let check = args.check === undefined || args.check === true ? "" : String(args.check);
      let snapshot = "";
      let signature = "";
      let note = "";
      let depends_on = [];
      const fromFile = Boolean(from);
      if (fromFile) {
        const slice = parseSliceFile(root, path.resolve(root, from));
        if (slice.errors.length > 0) {
          throw new Error(slice.errors.map((error) => `${slice.rel}: ${error.field}: ${error.reason}`).join("; "));
        }
        if (feature && feature !== slice.feature) throw new Error("feature disagrees with the slice");
        if (door && door !== slice.door) throw new Error("door disagrees with the slice");
        feature = slice.feature;
        door = slice.door;
        intent = slice.body;
        check = slice.check;
        snapshot = slice.id;
        signature = slice.signature;
        note = slice.rel;
        depends_on = slice.depends_on;
      }
      if (!feature || !door || !String(intent).trim()) {
        process.stderr.write("job-open requires --feature, --door, and --intent\n");
        return 2;
      }
      const job = openJob(root, { feature, door, intent, check, snapshot, signature, note, depends_on, fromFile });
      process.stdout.write(`${job.id}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "note-check") {
    const errors = noteCheck(root);
    for (const error of errors) process.stderr.write(`${error.path}: ${error.field}: ${error.reason}\n`);
    return errors.length ? 2 : 0;
  }
  if (command === "note-sync") {
    const result = noteSync(root);
    for (const error of result.errors) process.stderr.write(`${error.path}: ${error.field}: ${error.reason}\n`);
    for (const message of result.messages) process.stderr.write(`${message}\n`);
    process.stdout.write(`${JSON.stringify({ inbox: result.inbox, buffer: result.buffer, skipped: result.skipped })}\n`);
    return 0;
  }
  if (command === "claim") {
    if (!args.signature || args.signature === true || !args.engineer || args.engineer === true) {
      process.stderr.write("claim requires --signature and --engineer\n");
      return 2;
    }
    try {
      const snapshot = args.snapshot && args.snapshot !== true ? String(args.snapshot) : "";
      const claim = claimSignature(root, {
        signature: String(args.signature),
        engineer: String(args.engineer),
        snapshot,
      });
      process.stdout.write(`${JSON.stringify(claim)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "tree-add") {
    if (!args.engineer || args.engineer === true) {
      process.stderr.write("tree-add requires --engineer\n");
      return 2;
    }
    try {
      const added = treeAdd(root, String(args.engineer));
      process.stdout.write(`cd ${added.path}\nclaude --plugin-dir ${pluginRoot} --agent quorum:coordinator\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "tree-list") {
    try {
      process.stdout.write(`${treeList(root)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "tree-remove") {
    if (!args.engineer || args.engineer === true) {
      process.stderr.write("tree-remove requires --engineer\n");
      return 2;
    }
    try {
      const removed = treeRemove(root, String(args.engineer));
      process.stdout.write(`${JSON.stringify(removed)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "lead-ack") {
    if (!args.snapshot || args.snapshot === true) {
      process.stderr.write("lead-ack requires --snapshot\n");
      return 2;
    }
    const count = args.count === undefined ? 1 : Number(args.count);
    const timeoutSec = args["check-timeout"] === undefined ? 300 : Number(args["check-timeout"]);
    try {
      const ack = await leadAck(root, {
        snapshot: String(args.snapshot),
        count,
        checkTimeoutMs: timeoutSec * 1000,
      });
      process.stdout.write(`${JSON.stringify(ack)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "land") {
    if (!args.feature || args.feature === true || !args.snapshot || args.snapshot === true || !args.commit || args.commit === true) {
      process.stderr.write("land requires --feature, --snapshot, and --commit\n");
      return 2;
    }
    try {
      const landed = landFeature(root, {
        feature: String(args.feature),
        snapshot: String(args.snapshot),
        commit: String(args.commit),
      });
      process.stdout.write(`${JSON.stringify(landed)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (command === "merge-status") {
    const active = readJson(path.join(root, ".quorum", "active.json"), null);
    if (!active) {
      process.stdout.write(`${JSON.stringify({ allowed: false, reason: "job is missing" })}\n`);
      return 1;
    }
    const [allowed, reason] = mergeStatus(root, active.id);
    process.stdout.write(`${JSON.stringify({ allowed, reason })}\n`);
    return allowed ? 0 : 1;
  }
  if (command === "buffer-add") {
    if (!args.summary || !args.signature || !args.source) {
      process.stderr.write("buffer-add requires --summary, --signature, and --source\n");
      return 2;
    }
    const options = {};
    if (args.feature && args.feature !== true) options.feature = String(args.feature);
    if (args.door && args.door !== true) options.door = String(args.door);
    if (args["depends-on"] !== undefined) options.depends_on = [String(args["depends-on"])];
    if (args.snapshot !== undefined) options.snapshot = args.snapshot === true ? "" : String(args.snapshot);
    if (args.note !== undefined) options.note = args.note === true ? "" : String(args.note);
    if (args.check !== undefined) options.check = args.check === true ? "" : String(args.check);
    let filed;
    try {
      filed = fileReport(
        root,
        String(args.summary),
        String(args.signature),
        String(args.source),
        args.confirmed === true || args.confirmed === "true",
        options,
      );
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stdout.write(`${JSON.stringify(filed)}\n`);
    return 0;
  }
  if (command === "intake") {
    if (!args.file) {
      process.stderr.write("intake requires --file\n");
      return 2;
    }
    process.stdout.write(`${JSON.stringify(intakeFile(root, path.resolve(String(args.file))))}\n`);
    return 0;
  }
  if (command === "correction-add") {
    if (!args.note) {
      process.stderr.write("correction-add requires --note\n");
      return 2;
    }
    const signature = args.signature && args.signature !== true ? String(args.signature) : "";
    process.stdout.write(`${JSON.stringify(addCorrection(root, String(args.note), signature))}\n`);
    return 0;
  }
  if (command === "sample-note") {
    if (!args.note) {
      process.stderr.write("sample-note requires --note\n");
      return 2;
    }
    process.stdout.write(`${JSON.stringify(addSample(root, String(args.note)))}\n`);
    return 0;
  }
  if (command === "check-init") {
    if (!args.feature) {
      process.stderr.write("check-init requires --feature\n");
      return 2;
    }
    process.stdout.write(`${JSON.stringify(initCheck(root, String(args.feature)))}\n`);
    return 0;
  }
  if (command === "buffer-assign") {
    process.stdout.write(`${JSON.stringify(assign(root))}\n`);
    return 0;
  }
  if (command === "failure-add") {
    if (!args.signature) {
      process.stderr.write("failure-add requires --signature\n");
      return 2;
    }
    try {
      const result = recordFailure(root, String(args.signature));
      process.stdout.write(`${JSON.stringify({ action: result.action, count: result.count })}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  process.stderr.write(
    "usage: quorum.js <status|verify|swarm|job-open|job-close|merge-status|buffer-add|buffer-assign|failure-add|intake|correction-add|sample-note|check-init|note-check|note-sync|claim|tree-add|tree-list|tree-remove|lead-ack|land|hook> [--root DIR]\n",
  );
  return 2;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("quorum.js")) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code));
}
