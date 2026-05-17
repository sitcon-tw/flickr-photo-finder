import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildReviewNotes,
  peopleCountSpikeRows,
  peopleCountStats,
  reasonReuseRows,
  sceneReviewPackageRows,
} from "../scripts/commands/review-ai-run.mjs";
import { updateShardLog } from "../scripts/commands/log-ai-shard.mjs";
import { summarizeExecutionLog } from "../scripts/commands/status-ai-bulk-run.mjs";
import {
  designMetadataQualityWarningsForItem,
  visualDescriptionQualityWarningsForItem,
} from "../scripts/commands/validate-ai-proposals.mjs";
import { renderAiLabelingPrompt } from "../scripts/lib/ai/ai-labeling-prompt.mjs";
import {
  buildPeopleCountPairSummary,
  peopleCountDistribution,
  runQualityStatus,
} from "../scripts/commands/build-ai-report.mjs";

function item(photoId, fields) {
  return { fields, photo_id: photoId };
}

function peopleItem(photoId, count, reason = "畫面中可見多人坐在桌邊。") {
  return item(photoId, {
    people_count: {
      reason,
      value: count,
    },
  });
}

describe("AI bulk quality guards", () => {
  it("summarizes people_count distribution and detects run-level middle-value spikes", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, index) => peopleItem(`p5-${index}`, 5)),
      ...Array.from({ length: 160 }, (_, index) => peopleItem(`p1-${index}`, index % 20)),
    ];
    const rows = peopleCountSpikeRows(items, [], new Map());
    const stats = peopleCountStats(items);

    assert.equal(stats.count, 200);
    assert.equal(stats.topValues[0].value, 5);
    assert.ok(rows.some((row) => row[0] === "run" && row[3] === 5 && row[4] === 48));
  });

  it("detects album-level people_count concentration", () => {
    const items = [
      ...Array.from({ length: 18 }, (_, index) => peopleItem(`a-${index}`, 5)),
      ...Array.from({ length: 4 }, (_, index) => peopleItem(`b-${index}`, index + 1)),
    ];
    const photos = items.map((entry) => ({
      album_title: "集中相簿",
      photo_id: entry.photo_id,
    }));
    const rows = peopleCountSpikeRows(items, photos, new Map());

    assert.ok(rows.some((row) => row[0] === "album" && row[1] === "集中相簿" && row[3] === 5));
  });

  it("reports reason reuse by field", () => {
    const items = Array.from({ length: 8 }, (_, index) => peopleItem(`same-${index}`, 5, "畫面中可見約五人合照。"));
    const rows = reasonReuseRows(items);
    const peopleRow = rows.find((row) => String(row[0]).includes("people_count"));

    assert.ok(peopleRow);
    assert.equal(peopleRow[1], 8);
    assert.equal(peopleRow[2], 1);
    assert.equal(peopleRow[3], 8);
  });

  it("does not emit obsolete public status notes for child or identifiable-detail text", () => {
    const notes = buildReviewNotes([
      item("child-scene", {
        scene_tags: {
          reason: "畫面中可見小朋友在桌邊操作紙張。",
          value: ["兒童", "工作坊"],
        },
        visual_description: {
          reason: "描述本張照片中的桌面操作。",
          value: "小朋友坐在桌邊看紙張，旁邊有大人低頭協助。",
        },
      }),
    ]);
    const text = notes.join("\n");

    assert.doesNotMatch(text, /公開使用|public-use|可識別細節/);
  });

  it("builds scene review packages from scene tag co-occurrence", () => {
    const rows = sceneReviewPackageRows([
      item("speaker-screen", {
        scene_tags: {
          reason: "畫面中可見講者站在投影螢幕旁。",
          value: ["螢幕", "講者"],
        },
      }),
    ]);

    assert.deepEqual(rows[0].slice(0, 3), ["螢幕 + 講者", 1, "speaker-screen"]);
  });

  it("keeps design metadata warnings focused on layout support", () => {
    const warnings = designMetadataQualityWarningsForItem(item("banner", {
      has_negative_space: {
        reason: "畫面左側有大片牆面。",
        value: true,
      },
      recommended_uses: {
        reason: "畫面適合網站橫幅。",
        value: ["網站橫幅"],
      },
      visual_description: {
        reason: "描述畫面構圖。",
        value: "講者站在右側投影幕旁，左側牆面留有大片空白。",
      },
    }));

    assert.ok(warnings.some((warning) => warning.kind === "website-banner-missing-layout-support"));
  });

  it("flags generic visual descriptions for review", () => {
    const warnings = visualDescriptionQualityWarningsForItem(item("generic-description", {
      visual_description: {
        reason: "描述畫面。",
        value: "多名參與者在活動現場互動交流，畫面呈現交流情境。",
      },
    }));

    assert.ok(warnings.some((warning) => warning.kind === "generic-human-interaction"));
    assert.ok(warnings.some((warning) => warning.kind === "generic-frame-language"));
  });

  it("summarizes shard model, effort, duration, and Codex session coverage", () => {
    const summary = summarizeExecutionLog({
      shards: [
        {
          codex_session: "worker-session",
          duration_ms: 120000,
          model_name: "gpt-5.5",
          reasoning_effort: "xhigh",
          status: "completed",
          validate_status: "passed",
        },
        {
          duration_ms: null,
          model_name: "gpt-5.5",
          reasoning_effort: "medium",
          status: "running",
          validate_status: "unknown",
        },
      ],
    });

    assert.equal(summary.codex_session_shards, 1);
    assert.equal(summary.duration_logged_shards, 1);
    assert.equal(summary.duration_ms_total, 120000);
    assert.deepEqual(summary.model_name_counts, { "gpt-5.5": 2 });
    assert.deepEqual(summary.reasoning_effort_counts, { medium: 1, xhigh: 1 });
  });

  it("writes shard reasoning effort into the execution log", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-shard-log-"));
    const runDir = join(root, "run");
    const shardDir = join(root, "shards");
    await mkdir(runDir, { recursive: true });
    await mkdir(shardDir, { recursive: true });
    await writeFile(join(runDir, "manifest.json"), `${JSON.stringify({ run_id: "test-run" })}\n`);
    await writeFile(join(shardDir, "shard-execution-log.json"), `${JSON.stringify({
      run_id: "test-run",
      shards: [
        {
          agent_name: "",
          completed_at: "",
          codex_end_snapshot: null,
          codex_home: "",
          codex_session: "",
          codex_start_snapshot: null,
          codex_usage_delta: null,
          duration_ms: null,
          input_path: "",
          model_name: "",
          notes: "",
          reasoning_effort: "",
          repair_count: 0,
          retry_count: 0,
          shard: 0,
          started_at: "",
          status: "pending",
          validate_status: "unknown",
        },
      ],
    }, null, 2)}\n`);

    await updateShardLog({
      addRepair: false,
      addRetry: false,
      agentName: "worker-0",
      codexHome: "",
      codexSession: "",
      completedAt: "",
      durationMs: null,
      markCompleted: false,
      markStarted: true,
      modelName: "gpt-5.5",
      notes: null,
      reasoningEffort: "medium",
      repairCount: null,
      retryCount: null,
      runDir,
      shard: "00",
      shardDir,
      startedAt: "",
      status: "",
      validateStatus: "",
    });

    const log = JSON.parse(await readFile(join(shardDir, "shard-execution-log.json"), "utf8"));
    assert.equal(log.shards[0].reasoning_effort, "medium");
    assert.equal(log.shards[0].status, "running");
  });

  it("includes the parent Codex session placeholder in generated review commands", () => {
    const prompt = renderAiLabelingPrompt("tmp/ai-runs/example");

    assert.match(prompt, /pnpm ai:review -- --run-dir tmp\/ai-runs\/example --codex-session <parent-session-id>/);
  });

  it("flags people_count spike distribution for reports", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, index) => peopleItem(`p5-${index}`, 5)),
      ...Array.from({ length: 160 }, (_, index) => peopleItem(`p1-${index}`, index % 20)),
    ];
    const distribution = peopleCountDistribution(items);

    assert.ok(distribution.spike_values.some((entry) => entry.value === 5));
  });

  it("summarizes paired people_count deltas across runs", () => {
    const photos = [
      {
        attempts: [
          { fields: { people_count: { value: 5 } } },
          { fields: { people_count: { value: 25 } } },
        ],
        photo_id: "delta",
      },
      {
        attempts: [
          { fields: { people_count: { value: 3 } } },
          { fields: { people_count: { value: 3 } } },
        ],
        photo_id: "same",
      },
    ];

    const summary = buildPeopleCountPairSummary(photos, ["first", "second"]);

    assert.equal(summary.paired_count, 2);
    assert.equal(summary.exact_match_count, 1);
    assert.equal(summary.large_delta_count, 1);
    assert.equal(summary.extreme_delta_count, 1);
    assert.equal(summary.top_deltas[0].photo_id, "delta");
  });

  it("classifies run quality status for comparison reports", () => {
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "invalid", warning_count: 0 } }), "invalid");
    assert.equal(runQualityStatus({ isReviewSummaryStale: true, validation: { status: "valid", warning_count: 0 } }), "stale-review");
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "valid", warning_count: 3 } }), "valid-with-warnings");
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "valid", warning_count: 0 } }), "valid");
  });
});
