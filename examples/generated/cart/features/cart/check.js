import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");
const dir = mkdtempSync(join(tmpdir(), "cart-check-"));
const file = join(dir, "cart.json");

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function read() {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}
function fail(name, detail) {
  console.error(`FAIL ${name}: ${detail}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
function expect(name, args, code, out, cart) {
  const before = read();
  const r = run(args);
  if (r.code !== code) fail(name, `exit ${r.code} != ${code} (stderr: ${r.err.trim()})`);
  if (out !== undefined && r.out !== JSON.stringify(out) + "\n") fail(name, `stdout ${JSON.stringify(r.out)}`);
  if (code !== 0 && r.out !== "") fail(name, `stdout not empty on failure: ${JSON.stringify(r.out)}`);
  const after = read();
  if (cart === "unchanged") {
    if (after !== before) fail(name, "file changed on failure");
  } else if (cart !== undefined) {
    let parsed;
    try { parsed = JSON.parse(after); } catch { fail(name, `file not JSON: ${after}`); }
    if (JSON.stringify(parsed) !== JSON.stringify(cart)) fail(name, `file ${JSON.stringify(parsed)}`);
    if (after !== JSON.stringify(cart, null, 2) + "\n") fail(name, "file not 2-space pretty JSON with trailing newline");
  }
  console.log(`ok ${name}`);
}

const a1 = { id: "a1", name: "apple", qty: 3 };
const b2 = { id: "b2", name: "bread", qty: 1 };
const a1e = { id: "a1", name: "green apple", qty: 5 };
const F = ["--file", file];

if (existsSync(file)) fail("setup", "temp file exists");
expect("1 add a1", ["add", "--id", "a1", "--name", "apple", "--qty", "3", ...F], 0, a1, [a1]);
expect("2 add b2", ["add", "--id", "b2", "--name", "bread", "--qty", "1", ...F], 0, b2, [a1, b2]);
expect("3 add dup", ["add", "--id", "a1", "--name", "x", "--qty", "1", ...F], 1, undefined, "unchanged");
expect("4 edit a1", ["edit", "--id", "a1", "--name", "green apple", "--qty", "5", ...F], 0, a1e, [a1e, b2]);
expect("5 edit missing", ["edit", "--id", "zz", "--name", "q", "--qty", "1", ...F], 1, undefined, "unchanged");
expect("6 delete b2", ["delete", "--id", "b2", ...F], 0, { deleted: "b2" }, [a1e]);
expect("7 delete missing", ["delete", "--id", "zz", ...F], 1, undefined, "unchanged");
expect("8 bad qty", ["add", "--id", "c3", "--name", "x", "--qty", "abc", ...F], 2, undefined, "unchanged");
const d4 = { id: "d4", name: "y", qty: 2 };
expect("9 file first", ["add", ...F, "--id", "d4", "--name", "y", "--qty", "2"], 0, d4, [a1e, d4]);
expect("10 view absent", ["view", ...F], 2, undefined, "unchanged");
expect("11 view a1", ["view", "--id", "a1", ...F], 0, a1e, "unchanged");
expect("12 view d4 file first", ["view", ...F, "--id", "d4"], 0, d4, "unchanged");
expect("13 view missing", ["view", "--id", "zz", ...F], 1, undefined, "unchanged");
expect("14 view deleted", ["view", "--id", "b2", ...F], 1, undefined, "unchanged");
{
  const r = run(["view", "--id", "a1", ...F]);
  if (typeof JSON.parse(r.out).qty !== "number") fail("15 view qty", "qty is not a number");
  console.log("ok 15 view qty is number");
}

rmSync(dir, { recursive: true, force: true });
console.log("all cart checks passed");
