import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { parseCsv, parseSemicolonList } from "../lib/core/csv-utils.mjs";
import { searchTokensForValue } from "../lib/core/metadata-display.mjs";
import { listFields } from "../lib/core/photo-schema.mjs";

const defaultPhotosPath = "tmp/sheets-export/photos.csv";
const defaultAlbumsPath = "tmp/sheets-export/albums.csv";
const defaultTop = 5;
const listFieldSet = new Set(listFields);
const fieldWeights = new Map([
  ["recommended_uses", 6],
  ["scene_tags", 5],
  ["sponsorship_items", 5],
  ["sponsorship_tags", 5],
  ["mood_tags", 3],
  ["safe_crop", 3],
  ["has_negative_space", 3],
  ["orientation", 2],
  ["album_title", 2],
  ["visual_description", 2],
  ["people_count", 1],
]);
const searchableFields = [
  "recommended_uses",
  "scene_tags",
  "sponsorship_items",
  "sponsorship_tags",
  "mood_tags",
  "safe_crop",
  "has_negative_space",
  "orientation",
  "subject_type",
  "album_title",
  "event_name",
  "visual_description",
  "people_count",
  "priority_level",
  "curation_status",
  "public_use_status",
];

function printUsage() {
  console.log(`Usage:
  pnpm eval:finder-candidates -- --tasks tmp/finder-evals/tasks.json --output tmp/finder-evals/candidates.json

Options:
  --tasks <path>            JSON array of requester tasks.
  --photos <path>           Current photos CSV. Default: ${defaultPhotosPath}.
  --albums <path>           Albums CSV used for last_processed_at scope. Default: ${defaultAlbumsPath}.
  --processed-after <date>  Only include albums processed after this date. Default: all albums.
  --top <number>            Candidate count per task. Default: ${defaultTop}.
  --output <path>           Output JSON path. Required.
  --help, -h                Show this help.

This command generates metadata-only candidates. expected_fields are explicit
ranking hints, so this output is not an independent search-quality evaluation.
It does not call an LLM, inspect images, use credentials, or write Google Sheets.`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      albums: { type: "string" },
      photos: { type: "string" },
      "processed-after": { type: "string" },
      tasks: { type: "string" },
      top: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const top = values.top === undefined ? defaultTop : Number(values.top);
  const options = {
    albumsPath: values.albums ?? defaultAlbumsPath,
    help: values.help ?? false,
    outputPath: values.output ?? "",
    photosPath: values.photos ?? defaultPhotosPath,
    processedAfter: values["processed-after"] ?? "",
    tasksPath: values.tasks ?? "",
    top,
  };

  if (!options.help) {
    if (!options.tasksPath) {
      throw new Error("--tasks is required");
    }
    if (!options.outputPath) {
      throw new Error("--output is required");
    }
    if (!Number.isInteger(options.top) || options.top < 1) {
      throw new Error("--top must be a positive integer");
    }
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileProvenance(path) {
  const content = await readFile(path);
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function readCsvRecords(path) {
  const rows = parseCsv(await readFile(path, "utf8"));
  if (rows.length === 0) {
    return [];
  }
  const [headers, ...values] = rows;
  return values.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function processedAfterTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+08:00` : text;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --processed-after date: ${value}`);
  }
  return timestamp;
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("--tasks must point to a non-empty JSON array");
  }

  const ids = new Set();
  const expectedFieldNames = new Set([...searchableFields, "album_title_contains"]);
  for (const task of tasks) {
    if (!task || typeof task.id !== "string" || !task.id.trim()) {
      throw new Error("Each task must have a non-empty id");
    }
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    ids.add(task.id);
    if (typeof task.request !== "string" || !task.request.trim()) {
      throw new Error(`${task.id}: request must be a non-empty string`);
    }
    for (const field of ["must_have", "nice_to_have"]) {
      if (task[field] !== undefined && !Array.isArray(task[field])) {
        throw new Error(`${task.id}: ${field} must be an array`);
      }
    }
    if (task.expected_fields !== undefined
      && (!task.expected_fields || Array.isArray(task.expected_fields) || typeof task.expected_fields !== "object")) {
      throw new Error(`${task.id}: expected_fields must be an object`);
    }
    for (const [field, values] of Object.entries(task.expected_fields ?? {})) {
      if (!expectedFieldNames.has(field)) {
        throw new Error(`${task.id}: unknown expected field: ${field}`);
      }
      if (!Array.isArray(values)) {
        throw new Error(`${task.id}: expected_fields.${field} must be an array`);
      }
    }
  }
}

function scopeRecordsByAlbums(records, albums, processedAfter) {
  const albumIds = new Set(
    albums
      .filter((album) => {
        if (processedAfter === null) {
          return true;
        }
        const timestamp = Date.parse(album.last_processed_at || "");
        return Number.isFinite(timestamp) && timestamp > processedAfter;
      })
      .map((album) => album.album_id)
      .filter(Boolean),
  );
  return {
    albumCount: albumIds.size,
    records: records.filter((record) =>
      parseSemicolonList(record.album_ids).some((albumId) => albumIds.has(albumId)),
    ),
  };
}

function recordValues(record, field) {
  const rawValue = String(record[field] ?? "").trim();
  if (!rawValue) {
    return [];
  }
  if (listFieldSet.has(field)) {
    return parseSemicolonList(rawValue);
  }
  return [rawValue];
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[，。、「」『』（）()：:；;,.!?！？/\\|[\]{}<>#*_`~"'“”‘’\r\n\t-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const compact = normalized.replace(/\s+/g, "");
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      tokens.add(compact.slice(index, index + size));
    }
  }
  return tokens;
}

function fieldSearchText(record, field) {
  if (field === "people_count") {
    const count = Number(record.people_count);
    if (!Number.isInteger(count) || count < 0) {
      return "";
    }
    if (count === 0) {
      return `${count} 無人 空景`;
    }
    if (count === 1) {
      return `${count} 單人 一人`;
    }
    if (count <= 3) {
      return `${count} 少人 小組 互動`;
    }
    if (count <= 10) {
      return `${count} 多人 合照 交流`;
    }
    return `${count} 群眾 大合照 人潮`;
  }
  if (["album_title", "event_name", "visual_description"].includes(field)) {
    return String(record[field] ?? "").trim();
  }
  return recordValues(record, field)
    .flatMap((value) => searchTokensForValue(field, value))
    .filter(Boolean)
    .join(" ");
}

function expectedFieldScore(record, expectedFields = {}) {
  let score = 0;
  const matches = [];
  const misses = [];
  for (const [field, expectedValues] of Object.entries(expectedFields)) {
    const expected = Array.isArray(expectedValues) ? expectedValues.map(String).filter(Boolean) : [];
    if (expected.length === 0) {
      continue;
    }
    const recordField = field === "album_title_contains" ? "album_title" : field;
    const actual = recordValues(record, recordField);
    const rawText = String(record[recordField] ?? "");
    const matched = field === "album_title_contains"
      ? expected.filter((value) => compactText(rawText).includes(compactText(value)))
      : expected.filter((value) => actual.includes(value));
    if (matched.length > 0) {
      score += matched.length * (fieldWeights.get(field) ?? 2);
      matches.push({ field, matched });
    } else {
      misses.push({ field, expected });
    }
  }
  return { matches, misses, score };
}

function queryScore(record, task) {
  const query = [
    task.request,
    ...(task.must_have ?? []),
    ...(task.nice_to_have ?? []),
  ].join(" ");
  const queryTokens = tokenize(query);
  const queryCompact = compactText(query);
  let score = 0;
  const matchedFields = [];
  for (const field of searchableFields) {
    const text = fieldSearchText(record, field);
    if (!text) {
      continue;
    }
    const tokens = tokenize(text);
    let fieldScore = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) {
        fieldScore += token.length >= 3 ? 1.5 : 1;
      }
    }
    if (queryCompact && compactText(text).includes(queryCompact)) {
      fieldScore += 2;
    }
    if (fieldScore > 0) {
      score += fieldScore * (fieldWeights.get(field) ?? 1);
      matchedFields.push(field);
    }
  }
  return { matchedFields, score };
}

function statusScore(record) {
  let score = 0;
  if (record.public_use_status === "avoid") {
    score -= 100;
  }
  if (record.priority_level === "high") {
    score += 5;
  } else if (record.priority_level === "normal") {
    score += 2;
  }
  if (record.curation_status === "reviewed") {
    score += 4;
  } else if (record.curation_status === "ai_labeled") {
    score += 1;
  }
  return score;
}

function candidateEvidence(record) {
  return {
    album_title: record.album_title ?? "",
    curation_status: record.curation_status ?? "",
    has_negative_space: record.has_negative_space ?? "",
    image_preview_url: record.image_preview_url ?? "",
    mood_tags: record.mood_tags ?? "",
    orientation: record.orientation ?? "",
    people_count: record.people_count ?? "",
    photo_url: record.photo_url ?? "",
    priority_level: record.priority_level ?? "",
    public_use_status: record.public_use_status ?? "",
    recommended_uses: record.recommended_uses ?? "",
    safe_crop: record.safe_crop ?? "",
    scene_tags: record.scene_tags ?? "",
    sponsorship_items: record.sponsorship_items ?? "",
    sponsorship_tags: record.sponsorship_tags ?? "",
    subject_type: record.subject_type ?? "",
    visual_description: record.visual_description ?? "",
  };
}

function rankTaskCandidates(task, records, top) {
  const candidates = records
    .map((record) => {
      const expected = expectedFieldScore(record, task.expected_fields ?? {});
      const query = queryScore(record, task);
      const score = expected.score * 8 + query.score + statusScore(record);
      return {
        expected_field_matches: expected.matches,
        expected_field_misses: expected.misses,
        matched_search_fields: query.matchedFields,
        photo_id: String(record.photo_id ?? ""),
        score,
        table_evidence: candidateEvidence(record),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(left.photo_id).localeCompare(String(right.photo_id), "zh-Hant"),
    )
    .slice(0, top);

  return {
    id: task.id,
    request: task.request,
    finder_note: candidates.length === 0
      ? "沒有在表格資料中找到可交付候選。"
      : "依 expected_fields 與需求文字在表格資料中排序候選；未看原圖。",
    candidates,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const tasks = await readJson(options.tasksPath);
  validateTasks(tasks);

  const albums = await readCsvRecords(options.albumsPath);
  const photos = await readCsvRecords(options.photosPath);
  const scoped = scopeRecordsByAlbums(photos, albums, processedAfterTimestamp(options.processedAfter));
  const rankedTasks = tasks.map((task) => rankTaskCandidates(task, scoped.records, options.top));
  const [albumsSource, photosSource, tasksSource] = await Promise.all([
    fileProvenance(options.albumsPath),
    fileProvenance(options.photosPath),
    fileProvenance(options.tasksPath),
  ]);
  const output = {
    generated_at: new Date().toISOString(),
    output_kind: "metadata-candidates-with-expected-field-hints",
    album_count: scoped.albumCount,
    photo_count: scoped.records.length,
    processed_after: options.processedAfter || null,
    provenance: {
      albums: albumsSource,
      photos: photosSource,
      tasks: tasksSource,
    },
    task_count: tasks.length,
    tasks: rankedTasks,
  };

  await mkdir(join(options.outputPath, ".."), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Ranked candidates for ${rankedTasks.length} finder task(s) from ${scoped.records.length} scoped photo row(s).`);
  console.log(`Output: ${options.outputPath}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not rank finder task candidates: ${error.message}`);
  process.exitCode = 1;
}
