import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const features = path.join(process.cwd(), "features");
const names = existsSync(features)
  ? readdirSync(features, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(features, entry.name, "check.js")))
      .map((entry) => entry.name)
      .sort()
  : [];

if (names.length === 0) {
  process.stderr.write("no feature checks\n");
  process.exit(1);
}

for (const name of names) {
  const result = spawnSync(process.execPath, [path.join("features", name, "check.js")], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
