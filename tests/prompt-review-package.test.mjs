import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  compileDecisionPackage,
  expertRoles,
  parseArgs,
  prepareReviewPackage,
} from "../scripts/commands/build-prompt-review-package.mjs";

const validRun = "fixtures/ai-proposals/valid-basic";
const weakSearchRun = "fixtures/ai-proposals/warning-weak-search-visual-description";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function tempReviewDir() {
  const root = await mkdtemp(join(tmpdir(), "prompt-review-package-"));
  return join(root, "review");
}

describe("prompt review package workflow", () => {
  it("parses prepare and compile options", () => {
    assert.deepEqual(
      parseArgs(["node", "script", "--mode", "prepare", "--runs", validRun, weakSearchRun, "--top", "3", "--output", "tmp/review"]),
      {
        help: false,
        mode: "prepare",
        outputDir: "tmp/review",
        queriesPath: "",
        reviewDir: "",
        runDirs: [validRun, weakSearchRun],
        scoring: "idf",
        top: 3,
      },
    );
    assert.equal(parseArgs(["node", "script", "--mode", "compile", "--review-dir", "tmp/review"]).mode, "compile");
    assert.throws(() => parseArgs(["node", "script", "--mode", "compile"]), /compile mode requires --review-dir/);
  });

  it("prepares a review package with manifest, expert prompts, and report hints", async () => {
    const reviewDir = await tempReviewDir();
    const result = await prepareReviewPackage({
      outputDir: reviewDir,
      queriesPath: "",
      runDirs: [validRun, weakSearchRun],
      scoring: "idf",
      top: 5,
    });

    const manifestPath = join(reviewDir, "input-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.equal(result.inputManifest.runs.length, 2);
    assert.equal(manifest.version, 1);
    assert.deepEqual(
      manifest.runs.map((run) => run.manifest.run_id),
      ["fixture-valid-basic", "fixture-warning-weak-search-visual-description"],
    );
    assert.ok(manifest.warnings.some((warning) => warning.includes("prompt version is unknown")));
    assert.equal(
      result.reportLinks.suggested_report_command,
      `pnpm ai:report -- --runs ${validRun} ${weakSearchRun}`,
    );
    assert.equal((await exists(join(reviewDir, "expert-reviews"))), true);
    assert.equal((await exists(join(reviewDir, "search-results"))), true);

    for (const role of expertRoles) {
      const prompt = await readFile(join(reviewDir, "expert-prompts", `${role.id}.md`), "utf8");
      assert.ok(prompt.includes(role.title));
      assert.ok(prompt.includes("請只做唯讀分析"));
      assert.ok(prompt.includes("expert-reviews/"));
      assert.ok(prompt.includes("Review provenance"));
      assert.ok(prompt.includes("same-agent synthesis"));
      assert.ok(prompt.includes("session_id"));
      assert.ok(prompt.includes("review_provenance"));
    }
  });

  it("compiles expert review files into markdown and JSON decision artifacts", async () => {
    const reviewDir = await tempReviewDir();
    await prepareReviewPackage({
      outputDir: reviewDir,
      queriesPath: "",
      runDirs: [validRun],
      scoring: "idf",
      top: 5,
    });
    await mkdir(join(reviewDir, "expert-reviews"), { recursive: true });
    await writeFile(
      join(reviewDir, "expert-reviews", "prompt-architecture.json"),
      `${JSON.stringify({
        actionable_recommendations: [
          { area: "prompt", title: "重構成功標準" },
        ],
        review_provenance: {
          independent_evidence_read: true,
          reviewer_id: "agent-a",
          reviewer_type: "independent-agent",
          session_id: "session-a",
          shared_context_with: "",
        },
        role: "Prompt 架構",
        summary: "成功標準需要更具體。",
      }, null, 2)}\n`,
    );
    await writeFile(
      join(reviewDir, "expert-reviews", "schema-governance.md"),
      [
        "# Schema / 資料治理",
        "",
        "- 確認事實：目前不需要直接更動 schema。",
        "- 建議：先用 prompt 與 validator 訊號收斂。",
      ].join("\n"),
    );

    const result = await compileDecisionPackage({ reviewDir });
    const payload = JSON.parse(await readFile(join(reviewDir, "decision-package.json"), "utf8"));
    const markdown = await readFile(join(reviewDir, "decision-package.md"), "utf8");

    assert.equal(result.payload.run_count, 1);
    assert.equal(payload.expert_reviews.length, 2);
    assert.ok(payload.expert_reviews.some((review) => review.summary === "成功標準需要更具體。"));
    assert.ok(payload.expert_reviews.some((review) => review.review_provenance?.reviewer_type === "independent-agent"));
    assert.ok(markdown.includes("[prompt] 重構成功標準"));
    assert.ok(markdown.includes("type=independent-agent"));
    assert.ok(markdown.includes("session=session-a"));
    assert.ok(markdown.includes("type=not-declared"));
    assert.ok(markdown.includes("Schema / 資料治理"));
    assert.ok(result.markdown.includes("Owner Decisions"));
  });
});
