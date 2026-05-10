import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { parseCsv } from "./csv-utils.mjs";
import { photoHeaders, photoTableSchema } from "./photo-schema.mjs";

const outputDir = "tmp/review-panel-preview";
const outputPath = `${outputDir}/index.html`;
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";
const sidebarWidth = Number(process.env.SIDEBAR_WIDTH ?? 300);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function printUsage() {
  console.log(`Usage:
  pnpm review-panel:preview

Options:
  PORT=<port>  Preview server port. Default: ${port}.
  HOST=<host>  Preview server host. Default: ${host}.
  SIDEBAR_WIDTH=<px>  Mock Apps Script sidebar width. Default: ${sidebarWidth}.

This command generates ${outputPath} and serves a local mock of the Apps Script review sidebar.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  if (args.length > 0) {
    throw new Error(`Unknown option: ${args.join(" ")}`);
  }
}

function toRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

async function readFixtureRecords() {
  const text = await readFile("fixtures/photos.csv", "utf8");
  const [headers, ...rows] = parseCsv(text);
  if (!headers || photoHeaders.some((header, index) => headers[index] !== header)) {
    throw new Error("fixtures/photos.csv headers do not match photo schema");
  }
  return rows.map((row) => toRecord(headers, row));
}

async function readTaxonomy() {
  return JSON.parse(await readFile("data/tag-taxonomy.json", "utf8"));
}

function fieldForPreview(field, taxonomy) {
  return {
    descriptionZh: field.description_zh ?? "",
    labelZh: field.label_zh ?? field.name,
    multiValue: Boolean(field.multi_value),
    name: field.name,
    options: field.taxonomy_key ? taxonomy[field.taxonomy_key] || [] : field.type === "boolean" ? ["true", "false"] : [],
    readOnly: ["photo_id", "photo_url", "image_preview_url"].includes(field.name),
    required: Boolean(field.required),
    taxonomyKey: field.taxonomy_key ?? "",
    type: field.type ?? "string",
  };
}

function normalizePreviewRecord(record, index) {
  return {
    ...record,
    album_title: record.album_title || "SITCON 2026 相簿預覽",
    event_name: record.event_name || "SITCON",
    event_year: record.event_year || "2026",
    photo_id: record.photo_id || `preview-${index + 1}`,
  };
}

function buildState(record, rowNumber, fields) {
  return {
    approvedRequiredFields: photoTableSchema.approved_required_fields ?? [],
    errors: [],
    fields,
    record,
    reviewedRequiredFields: photoTableSchema.reviewed_required_fields ?? [],
    rowNumber,
  };
}

function buildPreviewModel(records, fields) {
  const states = records.map((record, index) => buildState(normalizePreviewRecord(record, index), index + 2, fields));
  const firstRow = states[0]?.rowNumber ?? 2;
  const buffer = buildBuffer(states, firstRow, 10, 10);
  return {
    bootstrapState: {
      current: states[0] ?? null,
      buffer,
    },
    states,
  };
}

function buildBuffer(states, rowNumber, beforeCount, afterCount) {
  const start = Math.max(2, Number(rowNumber) - Number(beforeCount || 0));
  const end = Math.min(states.length + 1, Number(rowNumber) + Number(afterCount || 0));
  return {
    centerRowNumber: Number(rowNumber),
    photos: states.filter((state) => state.rowNumber >= start && state.rowNumber <= end),
  };
}

function buildGoogleScriptMock(model) {
  return `<script>
window.__reviewPanelPreview = ${JSON.stringify(model)};
window.google = {
  script: {
    run: {
      _success: null,
      _failure: null,
      withSuccessHandler(handler) {
        this._success = handler;
        return this;
      },
      withFailureHandler(handler) {
        this._failure = handler;
        return this;
      },
      _respond(callback) {
        window.setTimeout(() => {
          try {
            this._success?.(callback());
          } catch (error) {
            this._failure?.(error);
          } finally {
            this._success = null;
            this._failure = null;
          }
        }, 120);
      },
      getReviewPhotoByRow(rowNumber) {
        this._respond(() => {
          const row = Number(rowNumber);
          const state = window.__reviewPanelPreview.states.find((item) => item.rowNumber === row);
          if (!state) throw new Error("Preview row not found: " + rowNumber);
          return state;
        });
      },
      getReviewPhotoBufferByRow(rowNumber, beforeCount, afterCount) {
        this._respond(() => {
          const states = window.__reviewPanelPreview.states;
          const row = Number(rowNumber);
          return {
            centerRowNumber: row,
            photos: states.filter((state) => state.rowNumber >= Math.max(2, row - Number(beforeCount || 0)) && state.rowNumber <= Math.min(states.length + 1, row + Number(afterCount || 0))),
          };
        });
      },
      getReviewPanelBootstrapState() {
        this._respond(() => window.__reviewPanelPreview.bootstrapState);
      },
      saveReviewPhoto(rowNumber, values) {
        this._respond(() => {
          const row = Number(rowNumber);
          const state = window.__reviewPanelPreview.states.find((item) => item.rowNumber === row);
          if (!state) throw new Error("Preview row not found: " + rowNumber);
          state.record = { ...state.record, ...values };
          return state;
        });
      },
    },
  },
};
</script>`;
}

function buildPreviewFrameCss() {
  return `<style>
html {
  background: #e5e7eb;
}

body {
  box-sizing: border-box;
  width: ${sidebarWidth}px;
  min-height: 100vh;
  margin: 0 0 0 auto;
  border-left: 1px solid #cbd5e1;
  box-shadow: -4px 0 18px rgba(15, 23, 42, 0.12);
}
</style>`;
}

async function writePreviewHtml() {
  const [panelHtml, records, taxonomy] = await Promise.all([
    readFile("apps-script/ReviewPanel.html", "utf8"),
    readFixtureRecords(),
    readTaxonomy(),
  ]);
  const fields = photoTableSchema.fields.map((field) => fieldForPreview(field, taxonomy));
  const model = buildPreviewModel(records, fields);
  const html = panelHtml
    .replace("<?!= bootstrapState ?>", JSON.stringify(model.bootstrapState).replace(/</g, "\\u003c"))
    .replace("</head>", `${buildPreviewFrameCss()}\n  </head>`)
    .replace("<script>", `${buildGoogleScriptMock(model)}\n    <script>`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, html);
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function startServer() {
  const root = resolve(outputDir);
  const server = createServer(async (request, response) => {
    const urlPath = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = resolve(root, relativePath);
    if (!filePath.startsWith(root)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    try {
      let targetPath = filePath;
      const fileStat = await stat(targetPath);
      if (!fileStat.isFile()) {
        sendText(response, 404, "Not found");
        return;
      }
      response.writeHead(200, {
        "content-length": fileStat.size,
        "content-type": mimeTypes[extname(targetPath)] ?? "application/octet-stream",
      });
      createReadStream(targetPath).pipe(response);
    } catch {
      sendText(response, 404, "Not found");
    }
  });

  server.on("error", (error) => {
    console.error(`Could not start review panel preview on http://${host}:${port}/: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Review panel preview written to ${outputPath}`);
    console.log(`Mock sidebar width: ${sidebarWidth}px`);
    console.log(`Review panel preview is running at http://${host}:${port}/`);
  });
}

try {
  parseArgs(process.argv);
  await writePreviewHtml();
  startServer();
} catch (error) {
  console.error(`Could not start review panel preview: ${error.message}`);
  process.exitCode = 1;
}
