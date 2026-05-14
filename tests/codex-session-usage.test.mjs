import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  computeTokenDelta,
  findCodexSessionFiles,
  getCodexTokenSnapshot,
  normalizeTokenUsage,
  selectTokenSnapshot,
} from "../scripts/lib/ai/codex-session-usage.mjs";

function tokenLine(timestamp, usage) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: usage,
      },
    },
  });
}

test("normalizes Codex usage with cached input excluded from shown total", () => {
  assert.deepEqual(
    normalizeTokenUsage({
      cached_input_tokens: 700,
      input_tokens: 1000,
      output_tokens: 50,
      reasoning_output_tokens: 10,
      total_tokens: 1050,
    }),
    {
      cached_input_tokens: 700,
      input_tokens: 1000,
      output_tokens: 50,
      reasoning_output_tokens: 10,
      shown_total_tokens: 350,
      total_tokens: 1050,
      uncached_input_tokens: 300,
    },
  );
});

test("selects the nearest token snapshot at or before a requested timestamp", () => {
  const snapshots = [
    { timestamp: "2026-05-14T00:00:00.000Z", usage: normalizeTokenUsage({ input_tokens: 100, cached_input_tokens: 20, output_tokens: 1 }) },
    { timestamp: "2026-05-14T00:10:00.000Z", usage: normalizeTokenUsage({ input_tokens: 200, cached_input_tokens: 40, output_tokens: 2 }) },
  ];

  assert.equal(selectTokenSnapshot(snapshots, { at: "2026-05-14T00:05:00.000Z" }), snapshots[0]);
  assert.equal(selectTokenSnapshot(snapshots, { at: "2026-05-14T00:15:00.000Z" }), snapshots[1]);
});

test("computes token deltas using shown total formula", () => {
  const start = {
    usage: normalizeTokenUsage({
      cached_input_tokens: 700,
      input_tokens: 1000,
      output_tokens: 50,
      reasoning_output_tokens: 10,
      total_tokens: 1050,
    }),
  };
  const end = {
    usage: normalizeTokenUsage({
      cached_input_tokens: 900,
      input_tokens: 1500,
      output_tokens: 90,
      reasoning_output_tokens: 25,
      total_tokens: 1590,
    }),
  };

  assert.deepEqual(computeTokenDelta(start, end), {
    cached_input_tokens: 200,
    input_tokens: 500,
    output_tokens: 40,
    reasoning_output_tokens: 15,
    shown_total_tokens: 340,
    total_tokens: 540,
    uncached_input_tokens: 300,
  });
});

test("loads Codex session JSONL snapshots from CODEX_HOME-like directory", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-session-usage-"));
  const sessionDir = join(codexHome, "sessions", "2026", "05", "14");
  await mkdir(sessionDir, { recursive: true });
  const sessionId = "019e-test-session";
  const sessionPath = join(sessionDir, `rollout-2026-05-14T00-00-00-${sessionId}.jsonl`);
  await writeFile(
    sessionPath,
    [
      JSON.stringify({ timestamp: "2026-05-14T00:00:00.000Z", type: "event_msg", payload: { type: "task_started" } }),
      tokenLine("2026-05-14T00:01:00.000Z", {
        cached_input_tokens: 100,
        input_tokens: 300,
        output_tokens: 20,
        reasoning_output_tokens: 5,
        total_tokens: 320,
      }),
      tokenLine("2026-05-14T00:02:00.000Z", {
        cached_input_tokens: 150,
        input_tokens: 400,
        output_tokens: 30,
        reasoning_output_tokens: 8,
        total_tokens: 430,
      }),
      "",
    ].join("\n"),
  );

  assert.deepEqual(await findCodexSessionFiles(sessionId, { codexHome }), [sessionPath]);
  const snapshot = await getCodexTokenSnapshot(sessionId, {
    at: "2026-05-14T00:01:30.000Z",
    codexHome,
  });

  assert.equal(snapshot.path, sessionPath);
  assert.equal(snapshot.line_number, 2);
  assert.equal(snapshot.usage.shown_total_tokens, 220);
});

test("reports missing Codex session files clearly", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-session-usage-"));

  await assert.rejects(
    () => getCodexTokenSnapshot("019e-missing", { codexHome }),
    /Could not find Codex session JSONL/,
  );
});
