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
        candidateHasThumbnail: Boolean(document.querySelector('.candidate-list img')),
        candidateHasRemove: [...document.querySelectorAll('.candidate-list button')].some((button) => button.textContent.includes('移除')),
        aiAssistant: document.querySelector('.ai-assistant-panel h2')?.textContent,
        overview: document.querySelector('.overview-panel h2')?.textContent,
        albumFilterLabel: [...document.querySelectorAll('.filter-control > span')].some((item) => item.textContent.includes('活動/相簿')),
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
    if (!hydratedValue.candidateHasThumbnail || !hydratedValue.candidateHasRemove) {
      throw new Error("Expected candidate panel to include thumbnails and per-item remove controls");
    }
    if (hydratedValue.aiAssistant !== "用 AI 助手找照片" || hydratedValue.overview !== "索引概覽") {
      throw new Error(`Expected AI assistant and overview panels, got ${hydratedValue.aiAssistant} / ${hydratedValue.overview}`);
    }
    if (!hydratedValue.albumFilterLabel) {
      throw new Error("Expected activity/album filter to remain in primary filters");
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
          .map((card) => card.dataset.photoId),
        firstCardAnchor: document.querySelector('.photo-card')?.id,
        firstCardHasLargeAction: [...document.querySelectorAll('.photo-card__actions button')].some((button) => button.textContent.includes('大圖'))
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
    if (updatedParams.has("curation")) {
      throw new Error(`Expected reset to clear all React-owned filter URL keys, got ${updatedValue.searchParams}`);
    }
    if (updatedParams.get("selected") !== "54682769955,54681614067") {
      throw new Error(`Expected reset to preserve selected URL key, got ${updatedValue.searchParams}`);
    }
    if (updatedValue.activeTaskLabel !== "全部照片") {
      throw new Error(`Expected reset to restore all task mode, got ${updatedValue.activeTaskLabel}`);
    }
    if (!String(updatedValue.firstCardAnchor).startsWith("photo-")) {
      throw new Error(`Expected photo cards to expose Finder anchors after reset, got ${updatedValue.firstCardAnchor}`);
    }
    if (!updatedValue.firstCardHasLargeAction) {
      throw new Error("Expected photo cards to expose large image action after reset");
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
          bodyOverflow: document.body.style.overflow,
          htmlOverflow: document.documentElement.style.overflow,
          appHidden: document.querySelector('#root')?.getAttribute('aria-hidden'),
          appInert: document.querySelector('#root')?.hasAttribute('inert'),
          activeClass: document.activeElement?.className || document.activeElement?.tagName
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
    if (previewOpenValue.htmlOverflow !== "hidden" && previewOpenValue.bodyOverflow !== "hidden") {
      throw new Error(`Expected preview dialog to lock page scroll, got ${JSON.stringify(previewOpenValue)}`);
    }
    if (previewOpenValue.appHidden !== "true" && !previewOpenValue.appInert) {
      throw new Error(`Expected preview dialog to make app root non-interactive, got ${JSON.stringify(previewOpenValue)}`);
    }
    await send(ws, 36, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await send(ws, 42, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await delay(400);
    const previewClosed = await evaluate(
      ws,
      37,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow,
        appHidden: document.querySelector('#root')?.getAttribute('aria-hidden'),
        appInert: document.querySelector('#root')?.hasAttribute('inert'),
        activeClass: document.activeElement?.className || document.activeElement?.tagName
      }))()`,
    );
    if (
      previewClosed.result.value.hasDialog ||
      previewClosed.result.value.htmlOverflow === "hidden" ||
      previewClosed.result.value.bodyOverflow === "hidden" ||
      previewClosed.result.value.appHidden === "true" ||
      previewClosed.result.value.appInert
    ) {
      throw new Error(`Expected Escape to close preview and restore background, got ${JSON.stringify(previewClosed.result.value)}`);
    }
    if (!String(previewClosed.result.value.activeClass).includes("photo-card__preview")) {
      throw new Error(`Expected Escape to restore focus to preview trigger, got ${previewClosed.result.value.activeClass}`);
    }

    const outsidePreviewButtonBox = await evaluate(
      ws,
      43,
      `(() => {
        const button = document.querySelector('.photo-card__preview');
        button?.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      })()`,
    );
    if (!outsidePreviewButtonBox.result.value) {
      throw new Error("Expected preview image button before outside-click smoke");
    }
    await send(ws, 44, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: outsidePreviewButtonBox.result.value.x,
      y: outsidePreviewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 45, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: outsidePreviewButtonBox.result.value.x,
      y: outsidePreviewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const outsidePoint = await evaluate(
      ws,
      46,
      `(() => {
        const overlay = document.querySelector('.photo-preview-layer')?.getBoundingClientRect();
        const dialog = document.querySelector('.photo-preview-dialog')?.getBoundingClientRect();
        return overlay && dialog ? { x: overlay.left + 8, y: overlay.top + 8 } : null;
      })()`,
    );
    if (!outsidePoint.result.value) {
      throw new Error("Expected preview dialog before outside-click dismiss smoke");
    }
    await send(ws, 47, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: outsidePoint.result.value.x,
      y: outsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 48, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: outsidePoint.result.value.x,
      y: outsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const outsideClosed = await evaluate(
      ws,
      49,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (outsideClosed.result.value.hasDialog || outsideClosed.result.value.htmlOverflow === "hidden" || outsideClosed.result.value.appInert) {
      throw new Error(`Expected outside click to close preview and restore background, got ${JSON.stringify(outsideClosed.result.value)}`);
    }

    await send(ws, 50, "Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send(ws, 63, "Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await delay(300);
    const mobilePreviewButtonBox = await evaluate(
      ws,
      51,
      `(() => {
        const button = document.querySelector('.photo-card__preview');
        button?.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      })()`,
    );
    if (!mobilePreviewButtonBox.result.value) {
      throw new Error("Expected preview image button before mobile swipe dismiss smoke");
    }
    await send(ws, 52, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: mobilePreviewButtonBox.result.value.x,
      y: mobilePreviewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 53, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: mobilePreviewButtonBox.result.value.x,
      y: mobilePreviewButtonBox.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const mobileSheet = await evaluate(
      ws,
      54,
      `(() => {
        const dialog = document.querySelector('.photo-preview-dialog');
        const rect = dialog?.getBoundingClientRect();
        const handle = dialog?.querySelector('.preview-sheet-handle')?.getBoundingClientRect();
        return rect && handle ? {
          x: rect.left + rect.width / 2,
          y: handle.top + handle.height / 2,
          bottomGap: Math.round(window.innerHeight - rect.bottom),
          handleHeight: Math.round(handle.height),
          actionPosition: getComputedStyle(dialog.querySelector('.preview-actions')).position,
          htmlOverflow: document.documentElement.style.overflow,
          targetClass: document.elementFromPoint(rect.left + rect.width / 2, handle.top + handle.height / 2)?.className
        } : null;
      })()`,
    );
    if (!mobileSheet.result.value) {
      throw new Error("Expected mobile preview sheet before swipe dismiss smoke");
    }
    if (Math.abs(mobileSheet.result.value.bottomGap) > 2 || mobileSheet.result.value.handleHeight < 4) {
      throw new Error(`Expected bottom-aligned mobile sheet with drag handle, got ${JSON.stringify(mobileSheet.result.value)}`);
    }
    if (mobileSheet.result.value.actionPosition !== "sticky" || mobileSheet.result.value.htmlOverflow !== "hidden") {
      throw new Error(`Expected mobile preview actions to remain sticky with background locked, got ${JSON.stringify(mobileSheet.result.value)}`);
    }
    await send(ws, 55, "Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: mobileSheet.result.value.x, y: mobileSheet.result.value.y, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 56, "Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: mobileSheet.result.value.x, y: mobileSheet.result.value.y + 52, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 57, "Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await delay(400);
    const mobileShortSwipe = await evaluate(
      ws,
      58,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        transform: getComputedStyle(document.querySelector('.photo-preview-dialog')).transform
      }))()`,
    );
    if (!mobileShortSwipe.result.value.hasDialog || mobileShortSwipe.result.value.htmlOverflow !== "hidden") {
      throw new Error(`Expected short mobile swipe to keep preview open, got ${JSON.stringify(mobileShortSwipe.result.value)}`);
    }
    const imageDragPoint = await evaluate(
      ws,
      64,
      `(() => {
        const rect = document.querySelector('.preview-image-link')?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + Math.min(80, rect.height / 2) } : null;
      })()`,
    );
    if (!imageDragPoint.result.value) {
      throw new Error("Expected preview image before mobile image-drag smoke");
    }
    await send(ws, 65, "Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: imageDragPoint.result.value.x, y: imageDragPoint.result.value.y, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 66, "Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: imageDragPoint.result.value.x, y: imageDragPoint.result.value.y + 156, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 67, "Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await delay(400);
    const mobileImageDrag = await evaluate(
      ws,
      68,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        htmlOverflow: document.documentElement.style.overflow
      }))()`,
    );
    if (!mobileImageDrag.result.value.hasDialog || mobileImageDrag.result.value.htmlOverflow !== "hidden") {
      throw new Error(`Expected image-area mobile drag to keep preview open, got ${JSON.stringify(mobileImageDrag.result.value)}`);
    }
    await send(ws, 59, "Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: mobileSheet.result.value.x, y: mobileSheet.result.value.y, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 60, "Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: mobileSheet.result.value.x, y: mobileSheet.result.value.y + 156, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await delay(80);
    await send(ws, 61, "Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await delay(400);
    const mobileSwipeClosed = await evaluate(
      ws,
      62,
      `(() => ({
        hasDialog: Boolean(document.querySelector('.photo-preview-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (
      mobileSwipeClosed.result.value.hasDialog ||
      mobileSwipeClosed.result.value.htmlOverflow === "hidden" ||
      mobileSwipeClosed.result.value.appInert
    ) {
      throw new Error(
        `Expected mobile swipe to close preview and restore background, got ${JSON.stringify({
          closed: mobileSwipeClosed.result.value,
          sheet: mobileSheet.result.value,
          shortSwipe: mobileShortSwipe.result.value,
        })}`,
      );
    }

    const mobileCandidateEntry = await evaluate(
      ws,
      69,
      `(() => {
        const bar = document.querySelector('.mobile-action-bar');
        const filterButton = document.querySelector('.mobile-filter-entry');
        const candidateButton = document.querySelector('.mobile-candidate-entry');
        const barStyle = bar ? getComputedStyle(bar) : null;
        const filterRect = filterButton?.getBoundingClientRect();
        const candidateRect = candidateButton?.getBoundingClientRect();
        return bar && barStyle && filterRect && candidateRect ? {
          filterText: filterButton.textContent,
          candidateText: candidateButton.textContent,
          position: barStyle.position,
          filterHeight: Math.round(filterRect.height),
          candidateHeight: Math.round(candidateRect.height),
          x: candidateRect.left + candidateRect.width / 2,
          y: candidateRect.top + candidateRect.height / 2
        } : null;
      })()`,
    );
    if (!mobileCandidateEntry.result.value) {
      throw new Error("Expected mobile action bar after preview sheet closes");
    }
    if (
      mobileCandidateEntry.result.value.filterText !== "篩選 0" ||
      mobileCandidateEntry.result.value.candidateText !== "候選 2" ||
      mobileCandidateEntry.result.value.position !== "fixed" ||
      mobileCandidateEntry.result.value.filterHeight < 44 ||
      mobileCandidateEntry.result.value.candidateHeight < 44
    ) {
      throw new Error(`Expected fixed mobile action bar with 44px targets, got ${JSON.stringify(mobileCandidateEntry.result.value)}`);
    }
    await evaluate(ws, 76, "document.querySelector('.mobile-filter-entry')?.click()");
    await delay(400);
    const mobileFilterSheet = await evaluate(
      ws,
      77,
      `(() => {
        const sheet = document.querySelector('.filter-sheet-dialog');
        const rect = sheet?.getBoundingClientRect();
        return rect ? {
          title: sheet.querySelector('h2')?.textContent,
          controlCount: sheet.querySelectorAll('.filter-multiselect').length,
          bottomGap: Math.round(window.innerHeight - rect.bottom),
          htmlOverflow: document.documentElement.style.overflow,
          appInert: document.querySelector('#root')?.hasAttribute('inert')
        } : null;
      })()`,
    );
    if (!mobileFilterSheet.result.value) {
      throw new Error("Expected mobile filter sheet to open");
    }
    if (
      mobileFilterSheet.result.value.title !== "主要篩選" ||
      mobileFilterSheet.result.value.controlCount < 1 ||
      Math.abs(mobileFilterSheet.result.value.bottomGap) > 2 ||
      mobileFilterSheet.result.value.htmlOverflow !== "hidden" ||
      !mobileFilterSheet.result.value.appInert
    ) {
      throw new Error(`Expected React Aria mobile filter sheet with locked background, got ${JSON.stringify(mobileFilterSheet.result.value)}`);
    }
    await send(ws, 86, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await send(ws, 87, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await delay(400);
    const mobileFilterClosed = await evaluate(
      ws,
      79,
      `(() => ({
        hasSheet: Boolean(document.querySelector('.filter-sheet-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (
      mobileFilterClosed.result.value.hasSheet ||
      mobileFilterClosed.result.value.htmlOverflow === "hidden" ||
      mobileFilterClosed.result.value.appInert
    ) {
      throw new Error(`Expected Escape to close filter sheet and restore background, got ${JSON.stringify(mobileFilterClosed.result.value)}`);
    }
    await evaluate(ws, 88, "document.querySelector('.mobile-filter-entry')?.click()");
    await delay(400);
    const filterOutsidePoint = await evaluate(
      ws,
      89,
      `(() => {
        const overlay = document.querySelector('.filter-sheet-layer')?.getBoundingClientRect();
        return overlay ? { x: overlay.left + 8, y: overlay.top + 8 } : null;
      })()`,
    );
    if (!filterOutsidePoint.result.value) {
      throw new Error("Expected filter sheet before outside-click dismiss smoke");
    }
    await send(ws, 90, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: filterOutsidePoint.result.value.x,
      y: filterOutsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 91, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: filterOutsidePoint.result.value.x,
      y: filterOutsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const mobileFilterOutsideClosed = await evaluate(
      ws,
      92,
      `(() => ({
        hasSheet: Boolean(document.querySelector('.filter-sheet-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (
      mobileFilterOutsideClosed.result.value.hasSheet ||
      mobileFilterOutsideClosed.result.value.htmlOverflow === "hidden" ||
      mobileFilterOutsideClosed.result.value.appInert
    ) {
      throw new Error(`Expected outside click to close filter sheet and restore background, got ${JSON.stringify(mobileFilterOutsideClosed.result.value)}`);
    }
    await send(ws, 70, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: mobileCandidateEntry.result.value.x,
      y: mobileCandidateEntry.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 71, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: mobileCandidateEntry.result.value.x,
      y: mobileCandidateEntry.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const mobileCandidateSheet = await evaluate(
      ws,
      72,
      `(() => {
        const sheet = document.querySelector('.candidate-sheet-dialog');
        const rect = sheet?.getBoundingClientRect();
        return rect ? {
          title: sheet.querySelector('h2')?.textContent,
          actionCount: sheet.querySelectorAll('.candidate-panel__actions > *').length,
          bottomGap: Math.round(window.innerHeight - rect.bottom),
          htmlOverflow: document.documentElement.style.overflow,
          appInert: document.querySelector('#root')?.hasAttribute('inert')
        } : null;
      })()`,
    );
    if (!mobileCandidateSheet.result.value) {
      throw new Error("Expected mobile candidate sheet to open");
    }
    if (
      mobileCandidateSheet.result.value.title !== "候選 2" ||
      mobileCandidateSheet.result.value.actionCount !== 3 ||
      Math.abs(mobileCandidateSheet.result.value.bottomGap) > 2 ||
      mobileCandidateSheet.result.value.htmlOverflow !== "hidden" ||
      !mobileCandidateSheet.result.value.appInert
    ) {
      throw new Error(`Expected React Aria mobile candidate sheet with locked background, got ${JSON.stringify(mobileCandidateSheet.result.value)}`);
    }
    await send(ws, 93, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await send(ws, 94, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await delay(400);
    const mobileCandidateClosed = await evaluate(
      ws,
      74,
      `(() => ({
        hasSheet: Boolean(document.querySelector('.candidate-sheet-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (
      mobileCandidateClosed.result.value.hasSheet ||
      mobileCandidateClosed.result.value.htmlOverflow === "hidden" ||
      mobileCandidateClosed.result.value.appInert
    ) {
      throw new Error(`Expected Escape to close candidate sheet and restore background, got ${JSON.stringify(mobileCandidateClosed.result.value)}`);
    }
    await evaluate(ws, 95, "document.querySelector('.mobile-candidate-entry')?.click()");
    await delay(400);
    const candidateOutsidePoint = await evaluate(
      ws,
      96,
      `(() => {
        const overlay = document.querySelector('.candidate-sheet-layer')?.getBoundingClientRect();
        return overlay ? { x: overlay.left + 8, y: overlay.top + 8 } : null;
      })()`,
    );
    if (!candidateOutsidePoint.result.value) {
      throw new Error("Expected candidate sheet before outside-click dismiss smoke");
    }
    await send(ws, 97, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: candidateOutsidePoint.result.value.x,
      y: candidateOutsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await send(ws, 98, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: candidateOutsidePoint.result.value.x,
      y: candidateOutsidePoint.result.value.y,
      button: "left",
      clickCount: 1,
    });
    await delay(400);
    const mobileCandidateOutsideClosed = await evaluate(
      ws,
      99,
      `(() => ({
        hasSheet: Boolean(document.querySelector('.candidate-sheet-dialog')),
        htmlOverflow: document.documentElement.style.overflow,
        appInert: document.querySelector('#root')?.hasAttribute('inert')
      }))()`,
    );
    if (
      mobileCandidateOutsideClosed.result.value.hasSheet ||
      mobileCandidateOutsideClosed.result.value.htmlOverflow === "hidden" ||
      mobileCandidateOutsideClosed.result.value.appInert
    ) {
      throw new Error(`Expected outside click to close candidate sheet and restore background, got ${JSON.stringify(mobileCandidateOutsideClosed.result.value)}`);
    }

    await evaluate(ws, 38, "[...document.querySelectorAll('.load-more-panel button')].find((button) => button.textContent.includes('載入更多'))?.click()");
    await delay(400);
    const loadMore = await evaluate(
      ws,
      39,
      `(() => ({
        cardCount: document.querySelectorAll('.photo-card').length,
        visibleText: [...document.querySelectorAll('.finder-status span')].map((item) => item.textContent).find((text) => text.includes('顯示前'))
      }))()`,
    );
    if (loadMore.result.value.cardCount !== 24) {
      throw new Error(`Expected load more to render 24 cards, got ${loadMore.result.value.cardCount}`);
    }
    if (!String(loadMore.result.value.visibleText).includes("顯示前 24 張")) {
      throw new Error(`Expected load more summary to show 24 visible photos, got ${loadMore.result.value.visibleText}`);
    }

    const loadMoreReset = await evaluate(
      ws,
      40,
      `(() => {
        const select = document.querySelector('select');
        const selectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        selectValueSetter.call(select, 'oldest');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { sort: select.value };
      })()`,
    );
    await delay(400);
    const loadMoreResetResult = await evaluate(
      ws,
      41,
      `(() => ({
        sort: ${JSON.stringify(loadMoreReset.result.value.sort)},
        cardCount: document.querySelectorAll('.photo-card').length,
        visibleText: [...document.querySelectorAll('.finder-status span')].map((item) => item.textContent).find((text) => text.includes('顯示前'))
      }))()`,
    );
    if (loadMoreResetResult.result.value.cardCount !== 12) {
      throw new Error(`Expected sort change after load-more to reset rendered cards to 12, got ${loadMoreResetResult.result.value.cardCount}`);
    }
    if (!String(loadMoreResetResult.result.value.visibleText).includes("顯示前 12 張")) {
      throw new Error(`Expected sort change after load-more to reset visible summary, got ${loadMoreResetResult.result.value.visibleText}`);
    }

    await evaluate(ws, 80, "document.querySelector('.mobile-filter-entry')?.click()");
    await delay(400);
    const filterPopoverOpen = await evaluate(
      ws,
      82,
      `(async () => {
        const sceneControl = [...document.querySelectorAll('.filter-sheet-dialog .filter-multiselect')]
          .find((control) => control.querySelector('.filter-multiselect__label')?.textContent?.includes('場景'));
        const trigger = sceneControl?.querySelector('.filter-multiselect__trigger');
        trigger?.click();
        window.__reactFilterTrigger = trigger;
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const popover = document.querySelector('.filter-multiselect__popover')?.getBoundingClientRect();
        return popover ? {
          top: Math.round(popover.top),
          right: Math.round(popover.right),
          bottom: Math.round(popover.bottom),
          left: Math.round(popover.left),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        } : null;
      })()`,
    );
    if (!filterPopoverOpen.result.value) {
      throw new Error("Expected mobile filter popover to open from FilterSheet");
    }
    if (
      filterPopoverOpen.result.value.left < 0 ||
      filterPopoverOpen.result.value.top < 0 ||
      filterPopoverOpen.result.value.right > filterPopoverOpen.result.value.viewportWidth ||
      filterPopoverOpen.result.value.bottom > filterPopoverOpen.result.value.viewportHeight
    ) {
      throw new Error(`Expected mobile filter popover to stay inside viewport, got ${JSON.stringify(filterPopoverOpen.result.value)}`);
    }
    await send(ws, 83, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await send(ws, 84, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await delay(200);
    const filterPopoverClosed = await evaluate(
      ws,
      85,
      `(() => ({
        hasPopover: Boolean(document.querySelector('.filter-multiselect__popover')),
        hasSheet: Boolean(document.querySelector('.filter-sheet-dialog')),
        focusRestored: document.activeElement === window.__reactFilterTrigger
      }))()`,
    );
    if (
      filterPopoverClosed.result.value.hasPopover ||
      !filterPopoverClosed.result.value.hasSheet ||
      !filterPopoverClosed.result.value.focusRestored
    ) {
      throw new Error(`Expected Escape to close filter popover and restore trigger focus without closing sheet, got ${JSON.stringify(filterPopoverClosed.result.value)}`);
    }
    const filterOnly = await evaluate(
      ws,
      6,
      `(async () => {
        const sceneControl = [...document.querySelectorAll('.filter-sheet-dialog .filter-multiselect')]
          .find((control) => control.querySelector('.filter-multiselect__label')?.textContent?.includes('場景'));
        sceneControl?.querySelector('.filter-multiselect__trigger')?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const option = [...document.querySelectorAll('.filter-multiselect__option')]
          .find((item) => item.textContent.includes('攤位'));
        option?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        return {
          resetDisabledBeforeClick: document.querySelector('.finder-reset').disabled,
          selectedOptionText: option?.textContent,
          filterEntryText: document.querySelector('.mobile-filter-entry')?.textContent
        };
      })()`,
    );
    if (filterOnly.result.value.resetDisabledBeforeClick) {
      throw new Error("Expected reset to remain enabled for filter-only state");
    }
    if (filterOnly.result.value.filterEntryText !== "篩選 1") {
      throw new Error(`Expected mobile filter entry to reflect active filter count, got ${filterOnly.result.value.filterEntryText}`);
    }
    await evaluate(ws, 7, "document.querySelector('.filter-sheet-clear')?.click()");
    await delay(400);
    const filterReset = await evaluate(
      ws,
      8,
      `(() => ({
        searchParams: window.location.search,
        sort: document.querySelector('select')?.value,
        filterEntryText: document.querySelector('.mobile-filter-entry')?.textContent,
        clearDisabled: document.querySelector('.filter-sheet-clear')?.disabled,
        sceneSummary: [...document.querySelectorAll('.filter-sheet-dialog .filter-multiselect')]
          .find((control) => control.querySelector('.filter-multiselect__label')?.textContent?.includes('場景'))
          ?.querySelector('.filter-multiselect__trigger span:first-child')?.textContent
      }))()`,
    );
    if (new URLSearchParams(filterReset.result.value.searchParams).has("scene")) {
      throw new Error(`Expected filter-only reset to clear scene query, got ${filterReset.result.value.searchParams}`);
    }
    if (
      filterReset.result.value.sort !== "oldest" ||
      filterReset.result.value.filterEntryText !== "篩選 0" ||
      !filterReset.result.value.clearDisabled ||
      filterReset.result.value.sceneSummary !== "不限"
    ) {
      throw new Error(`Expected sheet filter clear to update sheet and entry state, got ${JSON.stringify(filterReset.result.value)}`);
    }
    await evaluate(ws, 81, "document.querySelector('.filter-sheet-done')?.click()");
    await delay(400);

    await evaluate(ws, 9, "document.querySelector('.mobile-candidate-entry')?.click()");
    await delay(400);
    await evaluate(ws, 75, "document.querySelector('.candidate-sheet-dialog .candidate-panel__actions button:last-child')?.click()");
    await delay(400);
    const candidateClear = await evaluate(
      ws,
      10,
      `(() => ({
        searchParams: window.location.search,
        candidateHeading: document.querySelector('.candidate-sheet-dialog h2')?.textContent,
        entryText: document.querySelector('.mobile-candidate-entry')?.textContent,
        clearDisabled: document.querySelector('.candidate-sheet-dialog .candidate-panel__actions button:last-child')?.disabled
      }))()`,
    );
    if (new URLSearchParams(candidateClear.result.value.searchParams).has("selected")) {
      throw new Error(`Expected clear candidates to remove selected query, got ${candidateClear.result.value.searchParams}`);
    }
    if (
      candidateClear.result.value.candidateHeading !== "候選 0" ||
      candidateClear.result.value.entryText !== "候選 0" ||
      !candidateClear.result.value.clearDisabled
    ) {
      throw new Error(`Expected mobile candidate clear to update sheet and entry state, got ${JSON.stringify(candidateClear.result.value)}`);
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
