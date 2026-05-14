import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer } from "../lib/finder/serve.mjs";

const defaultUrl = "http://127.0.0.1:4932/";

function printUsage() {
  console.log(`Usage:
  node scripts/commands/smoke-react-pages-interaction.mjs [url]

Runs a headless Chrome interaction smoke check against the React preview app.
Default URL: ${defaultUrl}`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true, url: null };
  }
  if (args.length > 1) {
    throw new Error(`Expected at most one URL, got ${args.length}`);
  }
  return { help: false, url: args[0] ?? null };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child, timeoutMs = 1000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function findOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate an open local port");
  }
  return address.port;
}

function send(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) {
        return;
      }
      ws.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      resolve(message.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, id, expression) {
  return send(ws, id, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
}

async function openDevtoolsTarget(debugPort, url) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: "PUT" });
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error(`Could not open Chrome DevTools target: ${endpoint}`);
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for React preview server: ${url}`);
}

async function runInteractionSmoke({ url }) {
  const debugPort = await findOpenPort();
  const serverPort = url ? null : await findOpenPort();
  const server = serverPort
    ? startStaticServer({ rootDir: "tmp/pages-react", port: serverPort, title: "React preview interaction smoke" })
    : null;
  const targetUrl = url ?? `http://127.0.0.1:${serverPort}/`;
  if (server) {
    await waitForHttp(targetUrl);
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "react-preview-chrome-"));
  let ws = null;
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    chromeStderr += chunk;
  });

  try {
    const initialUrl = new URL(targetUrl);
    initialUrl.searchParams.set("q", "品牌");
    initialUrl.searchParams.set("sort", "newest");
    initialUrl.searchParams.set("task", "social");
    initialUrl.searchParams.append("use", "社群貼文");
    initialUrl.searchParams.append("scene", "攤位");
    initialUrl.searchParams.set("curation", "reviewed");
    initialUrl.searchParams.set("selected", "54682769955,54681614067");

    const target = await openDevtoolsTarget(debugPort, initialUrl.href);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    await send(ws, 1, "Runtime.enable");
    await send(ws, 2, "Page.enable");
    await delay(1000);

    const hydrated = await evaluate(
      ws,
      3,
      `(() => ({
        search: document.querySelector('input[type="search"]')?.value,
        sort: document.querySelector('select')?.value,
        sceneSelected: [...document.querySelectorAll('.filter-control select')]
          .some((select) => [...select.selectedOptions].some((option) => option.value === '攤位')),
        useSelected: [...document.querySelectorAll('.filter-control select')]
          .some((select) => [...select.selectedOptions].some((option) => option.value === '社群貼文')),
        activeTaskLabel: document.querySelector('.task-mode.is-active strong')?.textContent,
        candidateHeading: document.querySelector('.candidate-panel h2')?.textContent,
        location: window.location.search,
        resultCountText: document.querySelector('.finder-status strong')?.textContent
      }))()`,
    );
    const hydratedValue = hydrated.result.value;
    if (hydratedValue.search !== "品牌") {
      throw new Error(`Expected URL search to hydrate input, got ${hydratedValue.search}`);
    }
    if (hydratedValue.sort !== "newest") {
      throw new Error(`Expected URL sort to hydrate select, got ${hydratedValue.sort}`);
    }
    if (hydratedValue.activeTaskLabel !== "社群貼文") {
      throw new Error(`Expected URL task to hydrate active task mode, got ${hydratedValue.activeTaskLabel}`);
    }
    if (!hydratedValue.sceneSelected || !hydratedValue.useSelected) {
      throw new Error("Expected URL filter to hydrate active primary filter control");
    }
    if (hydratedValue.candidateHeading !== "候選 2") {
      throw new Error(`Expected URL selected to hydrate candidate panel, got ${hydratedValue.candidateHeading}`);
    }
    if (!String(hydratedValue.resultCountText).includes("/ 30 張照片")) {
      throw new Error(`Expected hydrated result count text, got ${hydratedValue.resultCountText}`);
    }

    const copySmoke = await evaluate(
      ws,
      31,
      `(async () => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__reactCandidateCopyText = text;
            }
          }
        });
        const copySelect = document.querySelector('.candidate-panel__actions select');
        const labels = [...copySelect.options].map((option) => option.textContent);
        const selectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        selectValueSetter.call(copySelect, 'collaboration');
        copySelect.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('.candidate-panel__actions button').click();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        return {
          labels,
          copiedText: window.__reactCandidateCopyText
        };
      })()`,
    );
    const copySmokeValue = copySmoke.result.value;
    const expectedCopyLabels = ["IM 討論版", "贊助佐證版", "協作檢查版", "純 Flickr URL"];
    if (JSON.stringify(copySmokeValue.labels) !== JSON.stringify(expectedCopyLabels)) {
      throw new Error(`Expected candidate copy labels to match vanilla UI, got ${JSON.stringify(copySmokeValue.labels)}`);
    }
    if (!String(copySmokeValue.copiedText).includes("Finder 清單:") || !String(copySmokeValue.copiedText).includes("Sheets:")) {
      throw new Error(`Expected collaboration copy to include Finder list and Sheets links, got ${copySmokeValue.copiedText}`);
    }

    const interaction = await evaluate(
      ws,
      4,
      `(() => {
        const input = document.querySelector('input[type="search"]');
        const select = document.querySelector('select');
        const heroTaskButton = [...document.querySelectorAll('.task-mode')]
          .find((button) => button.textContent.includes('網站橫幅'));
        const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const selectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        inputValueSetter.call(input, '舞台');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        selectValueSetter.call(select, 'discover');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        heroTaskButton.click();
        document.querySelector('.finder-reset').click();
        return { search: input.value, sort: select.value };
      })()`,
    );
    await delay(400);
    const updated = await evaluate(
      ws,
      5,
      `(() => ({
        interaction: ${JSON.stringify(interaction.result.value)},
        search: document.querySelector('input[type="search"]')?.value,
        sort: document.querySelector('select')?.value,
        searchParams: window.location.search,
        activeTaskLabel: document.querySelector('.task-mode.is-active strong')?.textContent,
        firstPhotoIds: [...document.querySelectorAll('.photo-card')]
          .slice(0, 2)
          .map((card) => card.dataset.photoId)
      }))()`,
    );
    const updatedValue = updated.result.value;
    if (updatedValue.search !== "") {
      throw new Error(`Expected reset to clear search, got ${updatedValue.search}`);
    }
    if (updatedValue.sort !== "recommended") {
      throw new Error(`Expected reset to restore recommended sort, got ${updatedValue.sort}`);
    }
    const updatedParams = new URLSearchParams(updatedValue.searchParams);
    if (updatedParams.has("q") || updatedParams.has("sort") || updatedParams.has("task")) {
      throw new Error(`Expected reset to clear owned URL query keys, got ${updatedValue.searchParams}`);
    }
    if (updatedParams.has("scene")) {
      throw new Error(`Expected reset to clear React-owned filter URL keys, got ${updatedValue.searchParams}`);
    }
    if (updatedParams.has("use")) {
      throw new Error(`Expected task switch/reset to clear hidden React-owned filter URL keys, got ${updatedValue.searchParams}`);
    }
    if (updatedParams.get("curation") !== "reviewed") {
      throw new Error(`Expected reset to preserve unimplemented filter URL keys, got ${updatedValue.searchParams}`);
    }
    if (updatedParams.get("selected") !== "54682769955,54681614067") {
      throw new Error(`Expected reset to preserve selected URL key, got ${updatedValue.searchParams}`);
    }
    if (updatedValue.activeTaskLabel !== "全部照片") {
      throw new Error(`Expected reset to restore all task mode, got ${updatedValue.activeTaskLabel}`);
    }
    if (updatedValue.firstPhotoIds[0] !== "54682769955" || updatedValue.firstPhotoIds[1] !== "54681614067") {
      throw new Error(`Expected preserved URL selected order to promote result cards, got ${JSON.stringify(updatedValue.firstPhotoIds)}`);
    }

    const previewButtonBox = await evaluate(
      ws,
      32,
      `(() => {
        const button = document.querySelector('.photo-card__preview');
        button?.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      })()`,
    );
    if (!previewButtonBox.result.value) {
      throw new Error("Expected at least one preview image button after reset");
    }
    await send(ws, 33, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: previewButtonBox.result.value.x,
      y: previewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 34, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: previewButtonBox.result.value.x,
      y: previewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const previewOpen = await evaluate(
      ws,
      35,
      `(() => {
        const dialog = document.querySelector('.photo-preview-dialog');
        return {
          title: dialog?.querySelector('h2')?.textContent,
          imageHref: dialog?.querySelector('.preview-image-link')?.href,
          imageHint: dialog?.querySelector('.preview-image-hint')?.textContent,
          candidateButton: dialog?.querySelector('.preview-actions button')?.textContent,
          actionCount: dialog?.querySelectorAll('.preview-actions > *').length,
          detailLabels: [...(dialog?.querySelectorAll('.preview-detail-row dt') ?? [])].map((item) => item.textContent),
          bodyOverflow: document.body.style.overflow
        };
      })()`,
    );
    const previewOpenValue = previewOpen.result.value;
    if (!previewOpenValue.title || previewOpenValue.imageHint !== "Flickr") {
      throw new Error(`Expected preview dialog with Flickr image hint, got ${JSON.stringify(previewOpenValue)}`);
    }
    if (!String(previewOpenValue.imageHref).includes("flickr.com/photos/sitcon/")) {
      throw new Error(`Expected preview image link to open Flickr photo page, got ${previewOpenValue.imageHref}`);
    }
    if (previewOpenValue.candidateButton !== "已加入候選") {
      throw new Error(`Expected preview candidate button to reflect selected state, got ${previewOpenValue.candidateButton}`);
    }
    if (previewOpenValue.actionCount !== 4) {
      throw new Error(`Expected four preview actions, got ${previewOpenValue.actionCount}`);
    }
    if (!previewOpenValue.detailLabels.includes("構圖") || !previewOpenValue.detailLabels.includes("整理狀態")) {
      throw new Error(`Expected preview detail labels, got ${JSON.stringify(previewOpenValue.detailLabels)}`);
    }
    if (previewOpenValue.bodyOverflow !== "hidden") {
      throw new Error(`Expected preview dialog to lock body scroll, got ${previewOpenValue.bodyOverflow}`);
    }
    await evaluate(ws, 36, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await delay(400);
    const previewClosed = await evaluate(
      ws,
      37,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        bodyOverflow: document.body.style.overflow
      }))()`,
    );
    if (previewClosed.result.value.hasDialog || previewClosed.result.value.bodyOverflow === "hidden") {
      throw new Error(`Expected Escape to close preview and restore scroll, got ${JSON.stringify(previewClosed.result.value)}`);
    }

    const filterOnly = await evaluate(
      ws,
      6,
      `(() => {
        const sceneSelect = [...document.querySelectorAll('.filter-control select')]
          .find((select) => [...select.options].some((option) => option.value === '攤位'));
        const option = [...sceneSelect.options].find((item) => item.value === '攤位');
        option.selected = true;
        sceneSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          resetDisabledBeforeClick: document.querySelector('.finder-reset').disabled,
          sceneValueBeforeClick: sceneSelect.value
        };
      })()`,
    );
    if (filterOnly.result.value.resetDisabledBeforeClick) {
      throw new Error("Expected reset to remain enabled for filter-only state");
    }
    await evaluate(ws, 7, "document.querySelector('.finder-reset').click()");
    await delay(400);
    const filterReset = await evaluate(
      ws,
      8,
      `(() => ({
        searchParams: window.location.search,
        anySelectedFilter: [...document.querySelectorAll('.filter-control select')]
          .some((select) => [...select.selectedOptions].some((option) => option.value))
      }))()`,
    );
    if (new URLSearchParams(filterReset.result.value.searchParams).has("scene")) {
      throw new Error(`Expected filter-only reset to clear scene query, got ${filterReset.result.value.searchParams}`);
    }
    if (filterReset.result.value.anySelectedFilter) {
      throw new Error("Expected filter-only reset to clear selected filter controls");
    }

    await evaluate(ws, 9, "document.querySelector('.candidate-panel__actions button:last-child').click()");
    await delay(400);
    const candidateClear = await evaluate(
      ws,
      10,
      `(() => ({
        searchParams: window.location.search,
        candidateHeading: document.querySelector('.candidate-panel h2')?.textContent
      }))()`,
    );
    if (new URLSearchParams(candidateClear.result.value.searchParams).has("selected")) {
      throw new Error(`Expected clear candidates to remove selected query, got ${candidateClear.result.value.searchParams}`);
    }
    if (candidateClear.result.value.candidateHeading !== "候選 0") {
      throw new Error(`Expected clear candidates to update candidate count, got ${candidateClear.result.value.candidateHeading}`);
    }

    ws.close();
    console.log(`React preview interaction smoke passed: ${targetUrl}`);
  } finally {
    ws?.close();
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    await delay(200);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((error) => {
      console.warn(`Could not remove temporary Chrome profile ${userDataDir}: ${error.message}`);
    });
    if (chrome.exitCode && chrome.exitCode !== 0) {
      console.error(chromeStderr);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

try {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
  } else {
    await runInteractionSmoke(options);
  }
} catch (error) {
  console.error(`React preview interaction smoke failed: ${error.message}`);
  process.exitCode = 1;
}
