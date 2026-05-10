import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  link,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { writeAiLabelingPrompt } from "./ai-labeling-prompt.mjs";
import { aiRunsDir } from "./workflow-paths.mjs";

const requiredRunFiles = ["manifest.json", "photos.json"];
const optionalRunFiles = ["input-photos.csv"];

function printUsage() {
  console.log(`Usage:
  pnpm eval:attempt -- --from <run-dir> --model <name> --round <number>

Options:
  --from <run-dir>     Base AI run directory to reuse as input.
  --model <name>       Model or provider label, for example claude, gpt, gemini.
  --round <number>     Attempt round for the same model/input, for example 1 or 2.
  --label <text>       Optional short label, for example visual-description.
  --attempt-id <id>    Explicit attempt directory name. Default derives from base, model, round, and label.
  --output-dir <path>  Parent directory for attempts. Default: tmp/ai-runs.
  --copy-images        Copy images instead of linking them.
  --help, -h           Show this help.

The command creates a normal AI run-shaped attempt directory that can be passed
to pnpm ai:review. It does not copy old proposals, review summaries, or update
plans from the source run.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    attemptId: "",
    copyImages: false,
    from: "",
    help: false,
    label: "",
    model: "",
    outputDir: aiRunsDir,
    round: 0,
  };

  function nextValue(index, optionName) {
    const value = args[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`${optionName} requires a value`);
    }
    return value;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--from") {
      options.from = nextValue(index, arg);
      index += 1;
    } else if (arg === "--model") {
      options.model = nextValue(index, arg);
      index += 1;
    } else if (arg === "--round") {
      options.round = Number(nextValue(index, arg));
      index += 1;
    } else if (arg === "--label") {
      options.label = nextValue(index, arg);
      index += 1;
    } else if (arg === "--attempt-id") {
      options.attemptId = nextValue(index, arg);
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--copy-images") {
      options.copyImages = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.from) {
      throw new Error("--from requires a run directory");
    }
    if (!options.model.trim()) {
      throw new Error("--model requires a non-empty label");
    }
    if (!Number.isInteger(options.round) || options.round < 1) {
      throw new Error("--round must be a positive integer");
    }
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (options.attemptId && sanitizeId(options.attemptId) !== options.attemptId) {
      throw new Error("--attempt-id may contain only letters, numbers, dots, underscores, and hyphens");
    }
  }

  return options;
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertRunDir(path) {
  const stat = await lstat(path).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`--from must be an existing run directory: ${path}`);
  }

  for (const file of requiredRunFiles) {
    if (!(await pathExists(join(path, file)))) {
      throw new Error(`${path} is missing ${file}`);
    }
  }
}

async function assertOutputDoesNotExist(path) {
  if (await pathExists(path)) {
    throw new Error(`attempt directory already exists: ${path}`);
  }
}

function defaultAttemptId(manifest, options) {
  const base = sanitizeId(manifest.run_id || manifest.base_run_id || "eval-attempt");
  const model = sanitizeId(options.model);
  const label = sanitizeId(options.label);
  return [base, "attempt", model, `r${options.round}`, label].filter(Boolean).join("-");
}

async function copyExistingFiles(sourceDir, attemptDir) {
  for (const file of [...requiredRunFiles, ...optionalRunFiles]) {
    const sourcePath = join(sourceDir, file);
    if (await pathExists(sourcePath)) {
      await copyFile(sourcePath, join(attemptDir, file));
    }
  }
}

async function linkImagesDirectory(sourceImagesDir, attemptImagesDir) {
  const target = relative(dirname(attemptImagesDir), sourceImagesDir) || sourceImagesDir;
  await symlink(target, attemptImagesDir, "dir");
  return "symlink";
}

async function hardlinkTree(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await hardlinkTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await link(sourcePath, targetPath);
    }
  }
}

async function prepareImages(sourceDir, attemptDir, options) {
  const sourceImagesDir = join(sourceDir, "images");
  const attemptImagesDir = join(attemptDir, "images");
  const sourceImagesStat = await stat(sourceImagesDir).catch(() => null);

  if (!sourceImagesStat || !sourceImagesStat.isDirectory()) {
    return "none";
  }

  if (options.copyImages) {
    await cp(sourceImagesDir, attemptImagesDir, { recursive: true });
    return "copy";
  }

  try {
    return await linkImagesDirectory(sourceImagesDir, attemptImagesDir);
  } catch {
    try {
      await hardlinkTree(sourceImagesDir, attemptImagesDir);
      return "hardlink";
    } catch (error) {
      throw new Error(`Could not link images; rerun with --copy-images to copy them instead: ${error.message}`);
    }
  }
}

async function readAttemptJson(path) {
  const attemptPath = join(path, "attempt.json");
  if (!(await pathExists(attemptPath))) {
    return null;
  }
  return readJson(attemptPath);
}

async function createAttempt(options) {
  const sourceDir = options.from.replace(/\/+$/g, "");
  await assertRunDir(sourceDir);

  const [sourceManifest, sourceAttempt] = await Promise.all([
    readJson(join(sourceDir, "manifest.json")),
    readAttemptJson(sourceDir),
  ]);

  const attemptId = options.attemptId || defaultAttemptId(sourceManifest, options);
  const attemptDir = join(options.outputDir, attemptId);
  await assertOutputDoesNotExist(attemptDir);
  await mkdir(attemptDir, { recursive: true });
  await copyExistingFiles(sourceDir, attemptDir);

  const createdAt = new Date().toISOString();
  const baseRunId = sourceAttempt?.base_run_id || sourceManifest.base_run_id || sourceManifest.run_id || "";
  const sourceRunId = sourceManifest.run_id || "";
  const imagesMode = await prepareImages(sourceDir, attemptDir, options);

  const attemptManifest = {
    ...sourceManifest,
    attempt_id: attemptId,
    base_run_id: baseRunId,
    created_at: createdAt,
    run_id: attemptId,
    source_run_id: sourceRunId,
  };
  await writeFile(join(attemptDir, "manifest.json"), `${JSON.stringify(attemptManifest, null, 2)}\n`);

  const attemptMetadata = {
    attempt_id: attemptId,
    attempt_version: 1,
    base_run_id: baseRunId,
    created_at: createdAt,
    images_mode: imagesMode,
    label: options.label,
    model: options.model,
    prompt_source: "prompts/ai-labeling.md",
    round: options.round,
    source_run_dir: sourceDir,
    source_run_id: sourceRunId,
  };
  await writeFile(join(attemptDir, "attempt.json"), `${JSON.stringify(attemptMetadata, null, 2)}\n`);

  const { promptPath } = writeAiLabelingPrompt(attemptDir);

  return {
    attemptDir,
    attemptId,
    imagesMode,
    promptPath,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await createAttempt(options);
  console.log(`AI attempt created: ${result.attemptDir}`);
  console.log(`- attempt id: ${result.attemptId}`);
  console.log(`- images: ${result.imagesMode}`);
  console.log(`- prompt: ${result.promptPath}`);
  console.log(`- next: give ai-labeling-prompt.md and this attempt directory to the model. The model should write metadata-proposals.json only; then run pnpm ai:review -- --run-dir ${result.attemptDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not create AI attempt: ${error.message}`);
  process.exitCode = 1;
}
