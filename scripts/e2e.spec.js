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

function writeSlice(root, feature, fields, body) {
  const dir = path.join(root, "notes", "app");
  mkdirSync(dir, { recursive: true });
  const text = [
    "---",
    `id: ${fields.id}`,
    `signature: ${fields.signature}`,
    `feature: ${feature}`,
    "door: two-way",
    "depends_on: []",
    `check: ${JSON.stringify(`node features/${feature}/check.js`)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
  writeFileSync(path.join(dir, `${feature}.md`), text);
}

function runQuorum(root, args) {
  const result = spawnSync(process.execPath, [quorum, ...args, "--root", root], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function runCoordinator(root, label, budget = "4") {
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
      budget,
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
        "greet",
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
        "greet",
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

function prepareProject(root, name) {
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name, private: true, type: "module" }, null, 2)}\n`);
  writeFileSync(path.join(root, ".gitignore"), ".quorum/\n");
  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude", "settings.json"),
    `${JSON.stringify({ permissions: { allow: ["Bash(node features/*/check.js)", "Bash(node *quorum.js *)"] } }, null, 2)}\n`,
  );
}

function runLead(root, label, prompt) {
  const result = spawnSync(
    "claude",
    [
      "--plugin-dir",
      pluginRoot,
      "--permission-mode",
      "bypassPermissions",
      "--permission-prompts",
      "none",
      "--max-budget-usd",
      "2",
      "--output-format",
      "json",
      "-p",
      prompt,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  writeFileSync(path.join(root, `${label}.claude.json`), `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.equal(result.status, 0, `lead ${label} failed (${result.status}): ${result.stderr}\n${(result.stdout || "").slice(-4000)}`);
}

function assertSdlcDocs(root, stage) {
  const intent = readFileSync(path.join(root, "intent.md"), "utf8");
  const architecture = readFileSync(path.join(root, "architecture.md"), "utf8");
  for (const heading of ["Problem", "Proposed outcome", "Constraints"]) {
    assert.match(intent, new RegExp(heading, "i"));
  }
  for (const command of ["add", "edit", "delete"]) {
    assert.match(architecture, new RegExp(command, "i"));
  }
  if (stage === "view") {
    assert.match(intent, /view/i);
    assert.match(architecture, /view/i);
  }
}

function assertGates(root) {
  runQuorum(root, ["note-check"]);
  const verify = JSON.parse(runQuorum(root, ["verify"]));
  assert.equal(verify.passed, true);
  assert.equal(verify.lint_clean, true);
  assert.equal(verify.check_exit, 0);
  const merge = JSON.parse(runQuorum(root, ["merge-status"]));
  assert.equal(merge.allowed, true);
  assert.match(merge.reason, /ready for human merge/);
  const check = spawnSync(process.execPath, ["features/cart/check.js"], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
}

function runCart(root, file, args) {
  return spawnSync(process.execPath, [path.join(root, "features", "cart", "cli.ts"), ...args, "--file", file], {
    cwd: root,
    encoding: "utf8",
  });
}

function cartJson(root, file, args) {
  const result = runCart(root, file, args);
  assert.equal(result.status, 0, `${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test(
  "a typescript shopping cart cli gains view by id",
  { skip: enabled ? false : "set QUORUM_E2E=1 to run the Claude Code harness end to end", timeout: 1_800_000 },
  () => {
    const root = path.join(pluginRoot, "examples", "generated", "cart");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    try {
      prepareProject(root, "cart-app");
      runLead(
        root,
        "intent",
        [
          "Write intent.md and stop. Do not write code, features/, notes/, or architecture.md.",
          "This is the accepted plan artifact. Use these sections: Problem, Proposed outcome, Affected users and systems, Constraints, Open questions.",
          "Status is accepted. The product is a TypeScript shopping-cart CLI.",
          "Outcome: add, edit, and delete items. Do not include view yet.",
          "Constraints: one file features/cart/cli.ts, a JSON array at --file, the command is the first argument, qty is a number, a missing id exits 1, and the check stays under 80 lines.",
        ].join(" "),
      );
      runLead(
        root,
        "architecture",
        [
          "Read intent.md. Write architecture.md and stop. Do not write code, features/, or notes/.",
          "This is the requirements and design artifact. Name the file layout, the TypeScript types, and the exact CLI.",
          "The first argument is the command. --file <path> comes after it.",
          "add --id --name --qty --file prints {\"id\",\"name\",\"qty\"}.",
          "edit --id --name --qty --file replaces that item and prints it, or exits 1 when the id is missing.",
          "delete --id --file prints {\"deleted\":\"<id>\"}, or exits 1 when the id is missing.",
          "Do not specify a view command.",
          "The gate is node features/cart/check.js, and it must stay under 80 lines.",
        ].join(" "),
      );
      assertSdlcDocs(root, "items");
      writeSlice(
        root,
        "cart",
        { id: "2026-10-21-cart-items", signature: "cart-items" },
        [
          "Build a TypeScript CLI at features/cart/cli.ts. Node runs it with `node features/cart/cli.ts`.",
          "The first argument is the command. --file <path> is a flag after that command.",
          "Do not add package.json, tsconfig, or any file outside features/cart/.",
          "Use erasable types only. No enums and no namespaces. Include at least one parameter type annotation.",
          "The cart is a JSON array stored at the --file path.",
          "add --id <id> --name <name> --qty <n> --file <path> creates the item and prints one JSON object {\"id\",\"name\",\"qty\"} with qty as a number.",
          "edit --id <id> --name <name> --qty <n> --file <path> replaces that item and prints it. Exit 1 when the id is missing.",
          "delete --id <id> --file <path> removes that item and prints {\"deleted\":\"<id>\"}. Exit 1 when the id is missing.",
          "Do not implement view.",
          "Before job-open, replace features/cart/check.js. Keep that file under 80 lines.",
          "The check adds an item, edits it, deletes it, and asserts that JSON, using a temporary --file.",
          "Read architecture.md and implement that design. Do not edit intent.md or architecture.md.",
          "Then run job-open --from notes/app/cart.md and do not pass a hand-built --intent. Run verify.",
        ].join(" "),
      );
      runQuorum(root, ["note-check"]);
      runQuorum(root, ["note-sync"]);
      runCoordinator(root, "cart-greenfield", "8");

      const cli = readFileSync(path.join(root, "features", "cart", "cli.ts"), "utf8");
      assert.match(cli, /:\s*(string|number)\b/);
      const store = path.join(root, "cart.json");
      assert.deepEqual(cartJson(root, store, ["add", "--id", "apple", "--name", "Apple", "--qty", "2"]), {
        id: "apple",
        name: "Apple",
        qty: 2,
      });
      assert.deepEqual(cartJson(root, store, ["edit", "--id", "apple", "--name", "Pear", "--qty", "4"]), {
        id: "apple",
        name: "Pear",
        qty: 4,
      });
      assert.deepEqual(cartJson(root, store, ["add", "--id", "berry", "--name", "Berry", "--qty", "1"]), {
        id: "berry",
        name: "Berry",
        qty: 1,
      });
      assert.deepEqual(cartJson(root, store, ["delete", "--id", "apple"]), { deleted: "apple" });
      const missing = runCart(root, store, ["edit", "--id", "apple", "--name", "Nope", "--qty", "1"]);
      assert.notEqual(missing.status, 0);
      const viewEarly = runCart(root, store, ["view", "--id", "berry"]);
      assert.notEqual(viewEarly.status, 0);
      const greenTrace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "latest.json"), "utf8"));
      assert.equal(greenTrace.passed, true);
      const greenCheck = readFileSync(path.join(root, "features", "cart", "check.js"), "utf8");
      assert.ok(greenCheck.split("\n").length <= 80, "check.js exceeds the 80 line cap");
      assertGates(root);
      runQuorum(root, ["job-close"]);

      runLead(
        root,
        "intent-view",
        [
          "Update intent.md in place. Keep the accepted cart outcome and add view by id.",
          "View prints one item by id and exits 1 when the id is missing. Add, edit, and delete stay.",
          "Do not write code or edit features/.",
        ].join(" "),
      );
      runLead(
        root,
        "architecture-view",
        [
          "Read intent.md. Update architecture.md in place.",
          "Add view --id <id> --file <path>. It prints {\"id\",\"name\",\"qty\"} with qty as a number, and exits 1 when the id is missing.",
          "Keep add, edit, and delete. The check still covers them and stays under 80 lines.",
          "Do not write code or edit features/.",
        ].join(" "),
      );
      assertSdlcDocs(root, "view");
      writeSlice(
        root,
        "cart",
        { id: "2026-10-21-cart-view", signature: "cart-view" },
        [
          "Add view by id to the existing TypeScript CLI at features/cart/cli.ts.",
          "Do not break add, edit, or delete.",
          "view --id <id> --file <path> prints {\"id\",\"name\",\"qty\"} for that item, with qty as a number. Exit 1 when the id is missing.",
          "Before job-open, edit features/cart/check.js so it also views an existing id and asserts exit 1 for a missing id.",
          "Keep check.js under 80 lines. After job-open the check is frozen.",
          "Then implement view. Run job-open --from notes/app/cart.md and do not pass a hand-built --intent. Run verify.",
        ].join(" "),
      );
      runQuorum(root, ["note-check"]);
      runQuorum(root, ["note-sync"]);
      runCoordinator(root, "cart-view", "8");

      const next = path.join(root, "cart-next.json");
      cartJson(root, next, ["add", "--id", "apple", "--name", "Apple", "--qty", "2"]);
      assert.deepEqual(cartJson(root, next, ["view", "--id", "apple"]), { id: "apple", name: "Apple", qty: 2 });
      assert.deepEqual(cartJson(root, next, ["edit", "--id", "apple", "--name", "Pear", "--qty", "3"]), {
        id: "apple",
        name: "Pear",
        qty: 3,
      });
      assert.deepEqual(cartJson(root, next, ["view", "--id", "apple"]), { id: "apple", name: "Pear", qty: 3 });
      assert.deepEqual(cartJson(root, next, ["delete", "--id", "apple"]), { deleted: "apple" });
      const absent = runCart(root, next, ["view", "--id", "apple"]);
      assert.notEqual(absent.status, 0);
      const viewCheck = readFileSync(path.join(root, "features", "cart", "check.js"), "utf8");
      assert.match(viewCheck, /view/);
      assert.ok(viewCheck.split("\n").length <= 80, "check.js exceeds the 80 line cap");
      const viewTrace = JSON.parse(readFileSync(path.join(root, ".quorum", "traces", "latest.json"), "utf8"));
      assert.equal(viewTrace.passed, true);
      assert.notEqual(viewTrace.job_id, greenTrace.job_id);
      assertGates(root);
      runQuorum(root, ["job-close"]);
      process.stdout.write(`cart project kept at ${root}\n`);
    } catch (error) {
      process.stderr.write(`e2e project kept at ${root}\n`);
      throw error;
    }
  },
);
