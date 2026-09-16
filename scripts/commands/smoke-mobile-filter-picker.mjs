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

async function clickElement(client, selector) {
  const point = await evaluate(client, `(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: 'center' });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const rect = element?.getBoundingClientRect();
    if (!rect) return null;
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    if (!element.contains(hit)) throw new Error('Click target covered: ' + ${JSON.stringify(selector)} + ' by ' + hit?.outerHTML.slice(0, 300));
    return point;
  })()`);
  if (!point) {
    throw new Error(`Missing interaction target: ${selector}`);
  }
  await click(client, point);
}

async function chooseAppearance(client, value) {
  if (await evaluate(client, "document.querySelector('#appearanceButton').dataset.appearance") !== value) {
    await clickElement(client, "#appearanceButton");
  }
}

async function assertAppearance(client, expected) {
  const appearance = await evaluate(client, `(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      preference: document.querySelector('#appearanceButton').dataset.appearance,
      label: document.querySelector('#appearanceButton').getAttribute('aria-label'),
    };
  })()`);
  if (appearance.theme !== expected || appearance.colorScheme !== expected || appearance.preference !== expected) {
    throw new Error(`Expected ${expected} appearance: ${JSON.stringify(appearance)}`);
  }
  if (!appearance.label?.includes("切換為")) throw new Error("Appearance button must describe its next action");
  return appearance;
}

async function checkAppearance(client) {
  logProgress("checking system appearance and persistent overrides");
  const before = await evaluate(client, `JSON.stringify({ url: location.href, result: document.querySelector('#resultSummary').textContent, candidates: document.querySelector('#candidateSummary').textContent })`);
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await assertAppearance(client, "dark");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await assertAppearance(client, "light");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await assertAppearance(client, "dark");
  await chooseAppearance(client, "light");
  await assertAppearance(client, "light");
  await client.call("Page.reload");
  await waitForPageReady(client);
  const restored = await assertAppearance(client, "light");
  if (restored.preference !== "light") throw new Error("Manual appearance did not survive reload");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await assertAppearance(client, "light");
  await clickElement(client, "#appearanceButton");
  await assertAppearance(client, "dark");
  await clickElement(client, "#appearanceButton");
  await assertAppearance(client, "light");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await assertAppearance(client, "light");

  logProgress("checking both appearances across responsive layouts");
  for (const appearance of ["light", "dark"]) {
    await chooseAppearance(client, appearance);
    await assertAppearance(client, appearance);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 761 });
      const layout = await evaluate(client, `(async () => {
        await new Promise(requestAnimationFrame);
        const logo = [...document.querySelectorAll('.brand-logo')].find(image => image.getClientRects().length);
        const button = document.querySelector('#appearanceButton');
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          logo: logo?.getAttribute('src'),
          loaded: logo?.naturalWidth > 0,
          photoFilter: getComputedStyle(document.querySelector('.photo-link img')).filter,
          buttonWidth: button.getBoundingClientRect().width,
          visibleIcons: [...button.querySelectorAll('svg')].filter(icon => icon.getClientRects().length).length,
        };
      })()`);
      const expectedLogo = appearance === "dark" ? "./assets/brand-logo-white.svg" : "./assets/brand-logo.svg";
      if (layout.overflow || layout.logo !== expectedLogo || !layout.loaded || layout.photoFilter !== "none" || layout.buttonWidth > 44 || layout.visibleIcons !== 1) {
        throw new Error(`Appearance layout failed at ${width}px in ${appearance}: ${JSON.stringify(layout)}`);
      }
    }
  }
  const after = await evaluate(client, `JSON.stringify({ url: location.href, result: document.querySelector('#resultSummary').textContent, candidates: document.querySelector('#candidateSummary').textContent })`);
  if (after !== before) throw new Error("Appearance changes modified the shared Finder state");

  logProgress("checking appearance when browser storage is unavailable");
  const storageBlock = await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable for smoke test'); } });",
  });
  await client.call("Page.reload");
  await waitForPageReady(client);
  await assertAppearance(client, "light");
  await chooseAppearance(client, "dark");
  await assertAppearance(client, "dark");
  await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: storageBlock.identifier });
}

async function runSmoke(client, pageUrl) {
  logProgress("configuring mobile viewport");
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
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
  if (!selectedState.selected.includes("攤位") || selectedState.triggerText !== "場景：攤位") {
    throw new Error(`Expected scene option to be selected, got ${JSON.stringify(selectedState)}`);
  }

  logProgress("checking compact advanced filters retain selections when collapsed");
  await clickElement(client, "#sceneFilter + .enhanced-select .enhanced-select-trigger");
  await clickElement(client, "#advancedFilters summary");
  await clickElement(client, "#priorityFilter + .enhanced-select .enhanced-select-trigger");
  await clickElement(client, '#priorityFilter + .enhanced-select .enhanced-select-option:not([data-value=""])');
  await clickElement(client, "#priorityFilter + .enhanced-select .enhanced-select-trigger");
  await clickElement(client, "#advancedFilters summary");
  const advancedState = await evaluate(client, `(() => ({
    open: document.querySelector('#advancedFilters').open,
    count: document.querySelector('#advancedFilterCount').textContent,
    selected: [...document.querySelector('#priorityFilter').selectedOptions].map(option => option.value).filter(Boolean),
    chips: document.querySelector('#activeFilters').textContent,
  }))()`);
  if (advancedState.open || advancedState.count !== "（1）" || advancedState.selected.length !== 1 || !advancedState.chips.includes("優先度")) {
    throw new Error(`Collapsed advanced filter lost its selection: ${JSON.stringify(advancedState)}`);
  }
  await clickElement(client, "#advancedFilters summary");
  await clickElement(client, "#priorityFilter + .enhanced-select .enhanced-select-trigger");
  await clickElement(client, '#priorityFilter + .enhanced-select .enhanced-select-option[data-value=""]');
  await clickElement(client, "#priorityFilter + .enhanced-select .enhanced-select-trigger");

  logProgress("checking inline sponsorship input preserves keywords and multiple selections");
  await clickElement(client, "#sponsorshipItemFilter");
  const sponsorLayout = await evaluate(client, `(() => {
    const field = document.querySelector('.autocomplete-field').getBoundingClientRect();
    const panel = document.querySelector('.autocomplete-panel').getBoundingClientRect();
    const filter = document.querySelector('.enhanced-select-trigger').getBoundingClientRect();
    return { height: field.height, filterHeight: filter.height, left: panel.left, right: panel.right, viewport: innerWidth };
  })()`);
  if (sponsorLayout.height !== sponsorLayout.filterHeight || sponsorLayout.left < 0 || sponsorLayout.right > sponsorLayout.viewport) {
    throw new Error(`Sponsorship control is not aligned or its suggestions overflow: ${JSON.stringify(sponsorLayout)}`);
  }
  await client.call("Input.insertText", { text: "badge" });
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const suggestion = await evaluate(client, "document.querySelector('.autocomplete-option').dataset.value");
  await clickElement(client, ".autocomplete-option");
  const sponsorValues = await evaluate(client, "new URL(location.href).searchParams.getAll('sponsorItem')");
  if (sponsorValues.length !== 2 || !sponsorValues.includes("badge") || !sponsorValues.includes(suggestion)) {
    throw new Error(`Sponsorship keyword or suggestion did not reach Finder state: ${JSON.stringify(sponsorValues)}`);
  }
  await clickElement(client, '.autocomplete-token[data-value="badge"]');
  const remainingSponsorValues = await evaluate(client, "new URL(location.href).searchParams.getAll('sponsorItem')");
  if (remainingSponsorValues.length !== 1 || remainingSponsorValues[0] !== suggestion) {
    throw new Error("Removing one sponsorship keyword also changed the other selection");
  }
  await clickElement(client, ".autocomplete-token");
  await clickElement(client, "#advancedFilters summary");

  logProgress("checking preview focus and mobile actions");
  await clickElement(client, "#closeFilterSheetButton");
  await clickElement(client, ".photo-link");
  await delay(250);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  const previewState = await evaluate(client, `(() => {
    const dialog = document.querySelector('#photoPreviewDialog');
    const actions = document.querySelector('.preview-actions').getBoundingClientRect();
    return {
      modal: dialog.matches(':modal'),
      focusInside: dialog.contains(document.activeElement),
      actionsVisible: actions.top >= 0 && actions.bottom <= innerHeight && actions.height < innerHeight / 2,
      photoId: document.querySelector('.photo-card').id,
      logoLoaded: document.querySelector('.brand-logo').naturalWidth > 0,
    };
  })()`);
  if (!previewState.modal || !previewState.focusInside || !previewState.actionsVisible || !previewState.logoLoaded) {
    throw new Error(`Preview or brand rendering failed: ${JSON.stringify(previewState)}`);
  }
  await clickElement(client, "#previewCandidateButton");
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const closedState = await evaluate(client, `(() => ({
    open: document.querySelector('#photoPreviewDialog').open,
    focusedPhoto: document.activeElement.closest('.photo-card')?.id,
    candidates: document.querySelector('#candidateSummary').textContent,
  }))()`);
  if (closedState.open || closedState.focusedPhoto !== previewState.photoId || !closedState.candidates.includes("1")) {
    throw new Error(`Preview did not restore photo focus and candidate state: ${JSON.stringify(closedState)}`);
  }

  logProgress("checking tablet workspace and task controls after mobile resize");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(150);
  const tabletState = await evaluate(client, `(() => ({
    taskPanelOpen: document.querySelector('#taskModeDetails').open,
    gridTop: document.querySelector('#photoGrid').getBoundingClientRect().top,
    sideTop: document.querySelector('.side-panel').getBoundingClientRect().top,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }))()`);
  if (!tabletState.taskPanelOpen || tabletState.gridTop > tabletState.sideTop + 1 || tabletState.overflow) {
    throw new Error(`Tablet workspace regression: ${JSON.stringify(tabletState)}`);
  }

  logProgress("checking compact controls across viewport widths");
  for (const width of [320, 768, 1440]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 761 });
    await delay(100);
    const layout = await evaluate(client, `(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      externalCue: getComputedStyle(document.querySelector('#sourceLink'), '::after').content.includes('↗'),
    }))()`);
    if (layout.overflow || !layout.externalCue) {
      throw new Error(`Responsive controls failed at ${width}px: ${JSON.stringify(layout)}`);
    }
  }
  await checkAppearance(client);
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
