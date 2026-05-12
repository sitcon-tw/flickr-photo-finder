import { spawnSync } from "node:child_process";

const checks = [
  ["data:validate", []],
  ["eval:validate-fixtures", []],
  ["finder:test", []],
];

for (const [script, args] of checks) {
  const result = spawnSync("pnpm", [script, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
