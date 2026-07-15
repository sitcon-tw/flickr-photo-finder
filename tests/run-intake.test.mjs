import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../scripts/commands/run-intake.mjs";
import { parseArgs as parseValidationArgs } from "../scripts/commands/validate-intake-run.mjs";

test("intake run arguments", async (t) => {
  await t.test("accepts the pnpm separator before the catalog baseline flag", () => {
    const options = parseArgs(["node", "run-intake.mjs", "--", "--all-albums"]);

    assert.equal(options.allAlbums, true);
    assert.equal(options.album, "");
  });

  await t.test("requires exactly one reconciliation scope", () => {
    assert.throws(
      () => parseArgs(["node", "run-intake.mjs", "--album", "123", "--all-albums"]),
      /exactly one/,
    );
  });
});

test("intake validation accepts the pnpm separator", () => {
  const options = parseValidationArgs(["node", "validate-intake-run.mjs", "--", "--run-dir", "tmp/run"]);

  assert.equal(options.runDir, "tmp/run");
});
