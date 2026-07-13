import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function runCli(entrypoint, args) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("finder evaluation separates retrieval ranking from metadata judgement", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "finder-evaluation-"));
  context.after(() => rm(root, { force: true, recursive: true }));

  const albumsPath = join(root, "albums.csv");
  const photosPath = join(root, "photos.csv");
  const scenariosPath = join(root, "scenarios.json");
  const tasksPath = join(root, "tasks.json");
  const evaluationOutput = join(root, "evaluation");
  const candidatesOutput = join(root, "candidates.json");

  await writeFile(albumsPath, "album_id,last_processed_at\nalbum-1,2026-07-01T00:00:00+08:00\n");
  await writeFile(
    photosPath,
    [
      "photo_id,album_ids,orientation,scene_tags,curation_status,priority_level,public_use_status,image_preview_url",
      "query-match,album-1,portrait,講者,ai_labeled,normal,approved,https://example.com/query.jpg",
      "criteria-match,album-1,landscape,場地,ai_labeled,normal,approved,https://example.com/criteria.jpg",
      "",
    ].join("\n"),
  );
  await writeFile(
    scenariosPath,
    `${JSON.stringify({
      version: 1,
      evaluation_kind: "metadata-retrieval",
      processed_after: "2026-06-11",
      scenarios: [
        {
          id: "speaker-layout",
          request: "講者",
          query_terms: ["講者"],
          acceptance_criteria: [
            { field: "orientation", op: "equals_any", required: true, value: ["landscape"] },
          ],
          reject_criteria: [],
        },
      ],
    }, null, 2)}\n`,
  );

  runCli("scripts/commands/evaluate-finder-scenarios.mjs", [
    "--photos", photosPath,
    "--albums", albumsPath,
    "--scenarios", scenariosPath,
    "--top", "1",
    "--output", evaluationOutput,
  ]);

  const evaluation = JSON.parse(await readFile(join(evaluationOutput, "results.json"), "utf8"));
  assert.equal(evaluation.evaluation_kind, "metadata-retrieval");
  assert.equal(evaluation.summary.current_scenarios_metadata_accepted, 0);
  assert.equal(evaluation.results[0].current.candidates[0].photo_id, "query-match");
  assert.equal(evaluation.results[0].current.first_metadata_accepted_rank, null);
  assert.match(evaluation.provenance.photos.sha256, /^[a-f0-9]{64}$/);
  assert.match(await readFile(join(evaluationOutput, "summary.md"), "utf8"), /只檢查 metadata/);

  await writeFile(
    tasksPath,
    `${JSON.stringify([
      {
        id: "landscape-candidate",
        request: "挑一張版面照片",
        expected_fields: { orientation: ["landscape"] },
      },
    ], null, 2)}\n`,
  );
  runCli("scripts/commands/rank-finder-task-candidates.mjs", [
    "--photos", photosPath,
    "--albums", albumsPath,
    "--tasks", tasksPath,
    "--top", "1",
    "--output", candidatesOutput,
  ]);

  const candidates = JSON.parse(await readFile(candidatesOutput, "utf8"));
  assert.equal(candidates.output_kind, "metadata-candidates-with-expected-field-hints");
  assert.equal(candidates.tasks[0].candidates[0].photo_id, "criteria-match");
  assert.match(candidates.provenance.tasks.sha256, /^[a-f0-9]{64}$/);
});
