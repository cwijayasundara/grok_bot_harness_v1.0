import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quorum = path.join(pluginRoot, "scripts", "quorum.js");
const enabled = process.env.QUORUM_E2E === "1";

function writeSlice(root, fields, body) {
  const dir = path.join(root, "notes", "app");
  mkdirSync(dir, { recursive: true });
  const text = [
    "---",
    `id: ${fields.id}`,
    `signature: ${fields.signature}`,
    `feature: greet`,
    "door: two-way",
    "depends_on: []",
    `check: ${JSON.stringify("node features/greet/check.js")}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "greet.md"), text);
}

function runQuorum(root, args) {
  const result = spawnSync(process.execPath, [quorum, ...args, "--root", root], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function runCoordinator(root, label) {
  const result = spawnSync(
    "claude",
    [
      "--plugin-dir",
      pluginRoot,
      "--agent",
      "quorum:coordinator",
      "--permission-mode",
      "bypassPermissions",
      "--permission-prompts",
      "none",
      "--max-budget-usd",
      "4",
      "--output-format",
      "json",
      "-p",
      "Work the confirmed buffer.",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 540000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const log = path.join(root, `${label}.claude.json`);
  writeFileSync(log, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.equal(
    result.status,
    0,
    `coordinator ${label} failed (${result.status}): ${result.stderr}\n${(result.stdout || "").slice(-4000)}`,
  );
  return result.stdout;
}

function expectGreet(root, expected) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { greet } from "./features/greet/feature.js"; if (greet() !== process.env.EXPECT) { console.error(JSON.stringify(greet())); process.exit(1); }',
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, EXPECT: expected } },
  );
  assert.equal(result.status, 0, `greet() was ${result.stderr || result.stdout}, expected ${expected}`);
}

test(
  "a greenfield feature and one small change go through the coordinator",
  { skip: enabled ? false : "set QUORUM_E2E=1 to run the Claude Code harness end to end", timeout: 1_200_000 },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "quorum-e2e-"));
    let passed = false;
    try {
      writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "greet-app", private: true, type: "module" }, null, 2)}\n`);
      writeFileSync(path.join(root, ".gitignore"), ".quorum/\n");
      mkdirSync(path.join(root, ".claude"), { recursive: true });
      writeFileSync(
        path.join(root, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            permissions: {
              allow: ["Bash(node features/*/check.js)", "Bash(node *quorum.js *)"],
            },
          },
          null,
          2,
        )}\n`,
      );

      writeSlice(
        root,
        { id: "2026-10-21-greet-hello", signature: "greet-hello" },
        [
          "Build features/greet from nothing.",
          "features/greet/check.js is missing. Before job-open, replace the check stub so it imports { greet } from ./feature.js and assert.equal(greet(), \"hello\").",
          "features/greet/feature.js must export function greet() that returns exactly hello.",
          "Keep each file under 80 lines. Do not import another feature. Do not add any other file.",
        ].join(" "),
      );
      runQuorum(root, ["note-sync"]);
      runCoordinator(root, "greenfield");
      expectGreet(root, "hello");
      const helloCheck = readFileSync(path.join(root, "features", "greet", "check.js"), "utf8");
      assert.match(helloCheck, /hello/);
      const helloTrace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "latest.json"), "utf8"));
      assert.equal(helloTrace.passed, true);
      runQuorum(root, ["job-close"]);
      assert.equal(readFileSync(path.join(root, ".quorum", "jobs", `${helloTrace.job_id}.json`), "utf8").includes('"closed": true'), true);

      writeFileSync(
        path.join(root, "features", "greet", "check.js"),
        'import assert from "node:assert/strict";\nimport { greet } from "./feature.js";\n\nassert.equal(greet(), "hello, quorum");\n',
      );
      writeSlice(
        root,
        { id: "2026-10-21-greet-quorum", signature: "greet-quorum" },
        'Change the existing feature. features/greet/check.js already asserts that greet() returns exactly "hello, quorum". Do not edit the check. Change features/greet/feature.js so greet() returns exactly hello, quorum. Do not add files.',
      );
      runQuorum(root, ["note-sync"]);
      runCoordinator(root, "change");
      expectGreet(root, "hello, quorum");
      const changedCheck = readFileSync(path.join(root, "features", "greet", "check.js"), "utf8");
      assert.match(changedCheck, /hello, quorum/);
      const changeTrace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "latest.json"), "utf8"));
      assert.equal(changeTrace.passed, true);
      assert.notEqual(changeTrace.job_id, helloTrace.job_id);
      runQuorum(root, ["job-close"]);
      passed = true;
    } finally {
      if (passed) rmSync(root, { recursive: true, force: true });
      else process.stderr.write(`e2e project kept at ${root}\n`);
    }
  },
);
