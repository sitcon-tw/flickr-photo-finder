import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildPagesArtifact } from "./build-pages.mjs";
import { startStaticServer } from "../lib/finder/serve.mjs";

const artifactDir = "tmp/pages-mobile-filter-smoke";
const chromeProfileDir = "tmp/mobile-filter-smoke-chrome";
const chromeCandidates = [
  process.env.CHROME_BIN,
  "google-chrome",
  "google-chrome-stable",
  "chromium-browser",
  "chromium",
].filter(Boolean);
const cdpTimeoutMs = 15000;
const smokeTimeoutMs = 60000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logProgress(message) {
  console.error(`[mobile-filter-smoke] ${message}`);
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out during ${label}`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the local server is ready.
    }
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function findChromeCommand() {
  for (const command of chromeCandidates) {
    if (command.includes("/")) {
      try {
        await access(command);
        return command;
      } catch {
        continue;
      }
    }
    const result = spawnSync("which", [command], { stdio: "ignore" });
    if (result.status === 0) {
      return command;
    }
  }
  throw new Error(`Could not find a Chrome executable. Tried: ${chromeCandidates.join(", ")}. Set CHROME_BIN to the Chrome or Chromium path.`);
}

async function prepareArtifact() {
  logProgress("building local Pages artifact");
  await rm(artifactDir, { recursive: true, force: true });
  const result = await buildPagesArtifact({
    outputDir: artifactDir,
    albumsCsvUrl: "./local/albums.csv",
    dataMode: "runtime-csv",
    photosCsvUrl: "./local/photos.csv",
  });
  await mkdir(join(result.outputDir, "local"), { recursive: true });
  await copyFile("fixtures/albums.csv", join(result.outputDir, "local/albums.csv"));
  await copyFile("fixtures/photos.csv", join(result.outputDir, "local/photos.csv"));
  return result.outputDir;
}

async function launchChrome(debugPort) {
  await rm(chromeProfileDir, { recursive: true, force: true });
  await mkdir(chromeProfileDir, { recursive: true });
  const chromeCommand = await findChromeCommand();
  const version = spawnSync(chromeCommand, ["--version"], { encoding: "utf8" });
  logProgress(`launching ${chromeCommand}${version.stdout ? ` (${version.stdout.trim()})` : ""}`);
  const chrome = spawn(chromeCommand, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-sandbox",
    "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfileDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  chrome.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  chrome.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(stderr.trim());
    }
  });

  try {
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, cdpTimeoutMs);
  } catch (error) {
    const chromeOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(-3000);
    const outputHint = chromeOutput ? ` Chrome output:\n${chromeOutput}` : "";
    throw new Error(`Timed out waiting for ${chromeCommand}. Set CHROME_BIN if Chrome is installed at a different path. ${error.message}.${outputHint}`);
  }
  return chrome;
}

async function openPage(debugPort, url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Could not open Chrome tab: HTTP ${response.status}`);
  }
  const target = await response.json();
  return target.webSocketDebuggerUrl;
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  let settled = false;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
    } else {
      resolve(message.result);
    }
  });
  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) {
      reject(new Error("Chrome WebSocket connection closed"));
    }
    pending.clear();
  });

  return new Promise((resolve, reject) => {
    const openTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error("Timed out connecting to Chrome WebSocket"));
      }
    }, cdpTimeoutMs);
    socket.addEventListener("open", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(openTimeout);
      resolve({
        call(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          const callPromise = new Promise((methodResolve, methodReject) => {
            pending.set(id, { resolve: methodResolve, reject: methodReject });
          });
          return withTimeout(callPromise, cdpTimeoutMs, `Chrome DevTools ${method}`).finally(() => {
            pending.delete(id);
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(openTimeout);
        reject(new Error("Chrome WebSocket connection failed"));
      }
    }, { once: true });
  });
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Evaluation failed: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function click(client, point) {
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function waitForPageReady(client) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, `(() => {
      const summary = document.querySelector('#resultSummary')?.textContent ?? '';
      return summary.includes('/');
    })()`);
    if (ready) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for finder data to render");
}

async function runSmoke(client, pageUrl) {
  logProgress("configuring mobile viewport");
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  logProgress(`navigating to ${pageUrl}`);
  await client.call("Page.navigate", { url: pageUrl });
  await waitForPageReady(client);

  logProgress("opening mobile filter sheet");
  const filterEntryPoint = await evaluate(client, `(() => {
    const button = document.querySelector('#mobileFilterButton');
    const rect = button?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!filterEntryPoint) {
    throw new Error("Mobile filter button was not found");
  }
  await click(client, filterEntryPoint);
  await delay(250);

  logProgress("opening scene enhanced select");
  const triggerPoint = await evaluate(client, `(() => {
    const label = [...document.querySelectorAll('.search-panel.is-filter-open label')]
      .find((item) => item.querySelector('span')?.textContent?.includes('場景'));
    const trigger = label?.querySelector('.enhanced-select-trigger');
    trigger?.scrollIntoView({ block: 'start', inline: 'nearest' });
    const rect = trigger?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!triggerPoint) {
    throw new Error("Scene enhanced select trigger was not found");
  }
  await click(client, triggerPoint);
  await delay(300);

  logProgress("checking contextual select panel");
  const openState = await evaluate(client, `(() => {
    const trigger = document.querySelector('.search-panel.is-filter-open label[data-filter-key="scene"] .enhanced-select-trigger');
    const panel = document.querySelector('.search-panel.is-filter-open label[data-filter-key="scene"] .enhanced-select-panel');
    const triggerRect = trigger?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return trigger && panel && triggerRect && panelRect ? {
      expanded: trigger.getAttribute('aria-expanded'),
      triggerBottom: Math.round(triggerRect.bottom),
      panelTop: Math.round(panelRect.top),
      panelBottom: Math.round(panelRect.bottom),
      panelLeft: Math.round(panelRect.left),
      panelRight: Math.round(panelRect.right),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      panelPosition: getComputedStyle(panel).position,
    } : null;
  })()`);
  if (!openState) {
    throw new Error("Scene enhanced select panel did not open");
  }

  const panelGap = openState.panelTop - openState.triggerBottom;
  if (openState.expanded !== "true") {
    throw new Error(`Expected trigger aria-expanded=true, got ${openState.expanded}`);
  }
  if (openState.panelPosition === "fixed") {
    throw new Error("Expected contextual panel, but panel is fixed-positioned");
  }
  if (panelGap < 0 || panelGap > 12) {
    throw new Error(`Expected panel near trigger, got gap ${panelGap}px (${JSON.stringify(openState)})`);
  }
  if (
    openState.panelLeft < 0 ||
    openState.panelRight > openState.viewportWidth ||
    openState.panelBottom > openState.viewportHeight
  ) {
    throw new Error(`Expected panel inside viewport, got ${JSON.stringify(openState)}`);
  }

  const optionPoint = await evaluate(client, `(() => {
    const option = [...document.querySelectorAll('.search-panel.is-filter-open label[data-filter-key="scene"] .enhanced-select-option')]
      .find((item) => item.textContent.includes('攤位'));
    const rect = option?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!optionPoint) {
    throw new Error("Scene option '攤位' was not found");
  }
  logProgress("selecting scene option");
  await click(client, optionPoint);
  await delay(300);

  const selectedState = await evaluate(client, `(() => ({
    filterButtonText: document.querySelector('#mobileFilterButton')?.textContent,
    triggerText: document.querySelector('.search-panel.is-filter-open label[data-filter-key="scene"] .enhanced-select-trigger span')?.textContent,
    selected: [...document.querySelectorAll('#sceneFilter option:checked')].map((option) => option.value),
  }))()`);
  if (selectedState.filterButtonText !== "篩選 1") {
    throw new Error(`Expected mobile filter count to update, got ${JSON.stringify(selectedState)}`);
  }
  if (!selectedState.selected.includes("攤位")) {
    throw new Error(`Expected scene option to be selected, got ${JSON.stringify(selectedState)}`);
  }
}

let staticServer;
let chrome;
let client;

try {
  await withTimeout((async () => {
    const outputDir = await prepareArtifact();
    const appPort = await availablePort();
    staticServer = startStaticServer({
      rootDir: outputDir,
      port: appPort,
      title: "Mobile filter smoke",
    });
    await waitForHttp(`http://127.0.0.1:${appPort}/`);

    const debugPort = await availablePort();
    chrome = await launchChrome(debugPort);
    const wsUrl = await openPage(debugPort, `http://127.0.0.1:${appPort}/`);
    client = await connect(wsUrl);
    await runSmoke(client, `http://127.0.0.1:${appPort}/`);
  })(), smokeTimeoutMs, "mobile filter smoke");
  console.log("Mobile filter picker smoke passed.");
} catch (error) {
  console.error(`Mobile filter picker smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  if (chrome) {
    chrome.kill("SIGTERM");
  }
  if (staticServer) {
    await new Promise((resolve) => staticServer.close(resolve));
  }
}
