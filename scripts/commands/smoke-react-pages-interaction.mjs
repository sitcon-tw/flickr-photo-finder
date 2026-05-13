import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    return { help: true, url: defaultUrl };
  }
  if (args.length > 1) {
    throw new Error(`Expected at most one URL, got ${args.length}`);
  }
  return { help: false, url: args[0] ?? defaultUrl };
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

async function runInteractionSmoke({ url }) {
  const debugPort = await findOpenPort();
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
    const initialUrl = new URL(url);
    initialUrl.searchParams.set("q", "品牌");
    initialUrl.searchParams.set("sort", "newest");
    initialUrl.searchParams.set("task", "social");
    initialUrl.searchParams.append("use", "社群貼文");
    initialUrl.searchParams.append("scene", "攤位");
    initialUrl.searchParams.set("curation", "reviewed");
    initialUrl.searchParams.set("selected", "200,100");

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
    if (!String(hydratedValue.resultCountText).includes("/ 30 張照片")) {
      throw new Error(`Expected hydrated result count text, got ${hydratedValue.resultCountText}`);
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
        activeTaskLabel: document.querySelector('.task-mode.is-active strong')?.textContent
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
    if (updatedParams.get("selected") !== "200,100") {
      throw new Error(`Expected reset to preserve selected URL key, got ${updatedValue.searchParams}`);
    }
    if (updatedValue.activeTaskLabel !== "全部照片") {
      throw new Error(`Expected reset to restore all task mode, got ${updatedValue.activeTaskLabel}`);
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

    ws.close();
    console.log(`React preview interaction smoke passed: ${url}`);
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
