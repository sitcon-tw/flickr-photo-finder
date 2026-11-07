import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildPagesArtifact } from "./build-pages.mjs";
import { startStaticServer } from "../lib/finder/serve.mjs";
import { parseCsv, csvEscape } from "../lib/core/csv-utils.mjs";

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
  const albumRows = parseCsv(await readFile("fixtures/albums.csv", "utf8"));
  const photoRows = parseCsv(await readFile("fixtures/photos.csv", "utf8"));
  // Dedicated source relationships in the temporary browser fixture, independent of catalog coverage.
  for (const album of [
    { album_id: "source-smoke-a", album_title: "SITCON Camp 2025 Day 1", event_name: "Camp", event_year: "2025" },
    { album_id: "source-smoke-b", album_title: "SITCON 2026 年會", event_name: "年會", event_year: "2026" },
  ]) albumRows.push(albumRows[0].map((field) => album[field] ?? ""));
  const membershipColumn = photoRows[0].indexOf("album_ids");
  photoRows[1][membershipColumn] = "source-smoke-a";
  photoRows[2][membershipColumn] = "source-smoke-a;source-smoke-b";
  for (const [name, rows] of [["albums", albumRows], ["photos", photoRows]]) {
    await writeFile(join(result.outputDir, `local/${name}.csv`), rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  }
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
    throw new Error(`Evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
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

async function runSourceSmoke(client, pageUrl) {
  logProgress("checking desktop source row, URL recovery and keyboard focus");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: pageUrl });
  await waitForPageReady(client);
  for (const width of [768, 1100, 1280]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(client, `(() => {
      const tops = [...document.querySelectorAll('.primary-search > label')].map((label) => Math.round(label.getBoundingClientRect().top));
      if (new Set(tops).size !== 1 || document.documentElement.scrollWidth > innerWidth) {
        throw new Error('Source row layout failed at ' + innerWidth + 'px: ' + tops);
      }
    })()`);
  }
  await evaluate(client, `(() => {
    const labels = [...document.querySelectorAll('.primary-search > label')];
    const names = labels.map((label) => label.querySelector('span').textContent);
    if (names.join(',') !== '搜尋,活動,年份,相簿,排序') throw new Error('Unexpected source order: ' + names);
    const tops = labels.map((label) => Math.round(label.getBoundingClientRect().top));
    if (new Set(tops).size !== 1) throw new Error('Primary controls wrapped: ' + tops);
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Desktop horizontal overflow');
    const select = document.querySelector('#sourceEventFilter');
    const firstEvents = [...select.options].filter((option) => option.value).slice(0, 2).map((option) => option.textContent);
    if (firstEvents.join(',') !== '年會,Camp') throw new Error('Activity priority changed: ' + firstEvents);
    const value = [...select.options].find((option) => option.value.startsWith('value:'))?.value;
    if (!value) throw new Error('No catalog activity option');
    select.closest('label').querySelector('.enhanced-select-trigger').click();
    [...select.closest('label').querySelectorAll('.enhanced-select-option')].find((button) => button.dataset.value === value).click();
    if (new URLSearchParams(location.search).get('event') !== value) throw new Error('Activity did not enter URL state');
    if (document.querySelector('#resultSummary').textContent.startsWith('0 /')) throw new Error('Selecting activity lost its photos');
    document.querySelector('#resetButton').click();
    select.closest('label').querySelector('.enhanced-select-trigger').focus();
  })()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await delay(100);
  await evaluate(client, `(() => {
    if (!document.activeElement.matches('.enhanced-select-option')) throw new Error('Arrow key did not focus an option');
  })()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await evaluate(client, `(() => {
    if (!document.activeElement.matches('.enhanced-select-trigger')) throw new Error('Escape did not restore trigger focus');
    const select = document.querySelector('#albumFilter');
    const option = [...select.options].find((option) => option.value.startsWith('id:'));
    option.textContent = '很長的相簿名稱用來確認選項可以完整閱讀與換行'.repeat(12);
    select.closest('label').querySelector('.enhanced-select-trigger').click();
    const panel = select.closest('label').querySelector('.enhanced-select-panel');
    if (panel.scrollWidth > panel.clientWidth + 1) throw new Error('Long album label overflow');
    select.closest('label').querySelector('.enhanced-select-trigger').click();
  })()`);
  await mkdir("tmp/source-filter-implementation", { recursive: true });
  const desktop = await client.call("Page.captureScreenshot", { format: "png" });
  await writeFile("tmp/source-filter-implementation/desktop.png", Buffer.from(desktop.data, "base64"));

  const stale = new URL(pageUrl);
  stale.search = new URLSearchParams({ year: "value:9999", album: "id:missing-from-catalog", scene: "攤位", q: "攤位", sort: "oldest", selected: "not-in-index" });
  await client.call("Page.navigate", { url: stale.href });
  await waitForPageReady(client);
  await evaluate(client, `(() => {
    const select = document.querySelector('#albumFilter');
    if (select.selectedOptions[0]?.value !== 'id:missing-from-catalog') throw new Error('Stale album disappeared from control');
    if (!document.querySelector('#activeFilters').textContent.includes('missing-from-catalog')) throw new Error('Stale album disappeared from chips');
    if (!document.querySelector('#resultSummary').textContent.startsWith('0 /')) throw new Error('Invalid source silently broadened');
    document.querySelector('#clearSourceButton').click();
    if (document.activeElement.id !== 'resetButton') throw new Error('Desktop source clear lost focus');
    const params = new URLSearchParams(location.search);
    if (params.has('year') || params.has('event') || params.has('album')) throw new Error('Source clear left a source restriction');
    if (params.get('q') !== '攤位' || params.get('scene') !== '攤位' || params.get('sort') !== 'oldest' || params.get('selected') !== 'not-in-index') throw new Error('Source clear removed unrelated state');
  })()`);

  const fixturePhotos = parseCsv(await readFile("fixtures/photos.csv", "utf8"));
  const photoAlbumTitle = fixturePhotos[1][fixturePhotos[0].indexOf("album_title")];
  for (const value of [photoAlbumTitle, `title:${photoAlbumTitle}`, "source-smoke-a"]) {
    const invalidUrl = new URL(pageUrl);
    invalidUrl.search = new URLSearchParams({ album: value });
    await client.call("Page.navigate", { url: invalidUrl.href });
    await waitForPageReady(client);
    await evaluate(client, `(() => {
      const value = ${JSON.stringify(value)};
      const select = document.querySelector('#albumFilter');
      const selected = select.selectedOptions[0];
      if (selected?.value !== value || !selected.textContent.endsWith('（目前索引無此選項）')) throw new Error('Invalid album label is incorrect');
      if (!document.querySelector('#activeFilters').textContent.includes(selected.textContent)) throw new Error('Invalid album missing from chips');
      if (!document.querySelector('#resultSummary').textContent.startsWith('0 /')) throw new Error('Unsupported album value matched photos');
      if (new URLSearchParams(location.search).get('album') !== value) throw new Error('Invalid album value was silently rewritten');
      document.querySelector('#activeFilters [data-filter-key="album"]').click();
      if (new URLSearchParams(location.search).has('album')) throw new Error('Invalid album could not be removed');
      if (document.querySelector('#resultSummary').textContent.startsWith('0 /')) throw new Error('Removing invalid album did not restore results');
    })()`);
  }

  logProgress("checking mobile source picker");
  await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await client.call("Page.navigate", { url: pageUrl });
  await waitForPageReady(client);
  await evaluate(client, `(() => {
    document.querySelector('#mobileFilterButton').click();
    const select = document.querySelector('#sourceEventFilter');
    select.closest('label').querySelector('.enhanced-select-trigger').click();
  })()`);
  await delay(200);
  await evaluate(client, `(() => {
    const label = document.querySelector('#sourceEventFilter').closest('label');
    const rect = label.querySelector('.enhanced-select-panel').getBoundingClientRect();
    if (rect.left < 0 || rect.right > innerWidth || rect.bottom > innerHeight) throw new Error('Mobile source picker outside viewport');
    const option = [...label.querySelectorAll('.enhanced-select-option')].find((button) => button.dataset.value.startsWith('value:') && !button.disabled);
    option.click();
    if (document.querySelector('#mobileFilterButton').textContent !== '篩選 1') throw new Error('Mobile source count incorrect');
    if (!document.querySelector('#activeFilters').textContent.includes('活動:')) throw new Error('Source chip missing');
    document.querySelector('#closeFilterSheetButton').click();
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Mobile horizontal overflow');
  })()`);
  const mobile = await client.call("Page.captureScreenshot", { format: "png" });
  await writeFile("tmp/source-filter-implementation/mobile.png", Buffer.from(mobile.data, "base64"));
  await evaluate(client, `document.querySelector('#clearSourceButton').focus()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await evaluate(client, `(() => {
    if (!document.querySelector('#clearSourceButton').hidden) throw new Error('Keyboard source clear did not clear the filters');
    if (document.activeElement.id !== 'mobileFilterButton') throw new Error('Mobile source clear lost focus');
  })()`);
}


async function runSourceHintSmoke(client, pageUrl) {
  logProgress("checking compact source hints and full filter context");
  const restricted = new URL(pageUrl);
  restricted.search = new URLSearchParams({ year: "value:2025" });
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call("Page.navigate", { url: restricted.href });
  await waitForPageReady(client);
  await clickElement(client, "#sourceEventFilter + .enhanced-select .enhanced-select-trigger");
  await evaluate(client, `(() => {
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    const option = panel.querySelector('[data-value="value:年會"]');
    if (!option.disabled || option.querySelector('.source-option-marker').textContent !== '⊘' || option.querySelector('.source-option-label').textContent !== '年會') throw new Error('Unavailable source did not use its compact marker');
    if (document.getElementById(option.getAttribute('aria-describedby'))?.textContent !== '無相符照片') throw new Error('Unavailable source lost its text description');
    if (panel.querySelector('.source-filter-hint').hidden || !panel.querySelector('.source-filter-context').hidden) throw new Error('Hint did not start collapsed');
    panel.querySelector('.source-context-toggle').focus();
  })()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await evaluate(client, `(() => {
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    const context = panel.querySelector('.source-filter-context');
    if (context.hidden || context.querySelector('dt')?.textContent !== '年份' || context.querySelector('dd')?.textContent !== '2025') throw new Error('Other-condition context is incorrect: ' + JSON.stringify({hidden:context.hidden,text:context.textContent,focus:document.activeElement.className}));
    if (!document.activeElement.matches('.source-context-toggle')) throw new Error('Context disclosure lost keyboard focus');
    const search = panel.querySelector('input');
    search.value = 'no-such-option-name';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    if (panel.querySelector('.enhanced-select-empty')?.textContent !== '沒有符合的選項' || !panel.querySelector('.source-filter-hint').hidden) throw new Error('Option search was confused with photo availability');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    if (context.hidden) throw new Error('Searching option names reset expanded context');
  })()`);
  const desktop = await client.call("Page.captureScreenshot", { format: "png" });
  await writeFile("tmp/source-filter-implementation/hint-desktop.png", Buffer.from(desktop.data, "base64"));

  logProgress("checking long context, selected unavailable sources and small viewports");
  const longSearch = '完整搜尋內容'.repeat(30) + ' test@example.com';
  const longState = new URL(pageUrl);
  longState.search = new URLSearchParams({ event: 'value:年會', year: 'value:2025', scene: '攤位', q: longSearch, task: 'social', sort: 'oldest' });
  await client.call("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await client.call("Page.navigate", { url: longState.href });
  await waitForPageReady(client);
  await clickElement(client, '#mobileFilterButton');
  await clickElement(client, '#sourceEventFilter + .enhanced-select .enhanced-select-trigger');
  await clickElement(client, '#sourceEventFilter + .enhanced-select .source-context-toggle');
  await evaluate(client, `(() => {
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    const context = panel.querySelector('.source-filter-context');
    const labels = [...context.querySelectorAll('dt')].map((term) => term.textContent);
    const search = [...context.querySelectorAll('dt')].find((term) => term.textContent === '搜尋');
    if (search?.nextElementSibling.textContent !== ${JSON.stringify(longSearch)}) throw new Error('Local search context was sanitized or truncated');
    if (labels.includes('活動') || labels.includes('排序') || labels.includes('優先檢視')) throw new Error('Context included its own field or ranking controls');
    const selected = panel.querySelector('[data-value="value:年會"]');
    if (selected.disabled || selected.getAttribute('aria-selected') !== 'true' || !selected.textContent.includes('無相符照片')) throw new Error('Selected unavailable option cannot be removed');
  })()`);

  for (const height of [640, 400]) {
    await client.call("Emulation.setDeviceMetricsOverride", { width: 320, height, deviceScaleFactor: 1, mobile: true });
    await delay(100);
    await evaluate(client, `(() => {
      const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
      const rect = panel.getBoundingClientRect();
      const sheet = document.querySelector('.search-panel').getBoundingClientRect();
      if (rect.left < 0 || rect.right > innerWidth || rect.top < Math.max(0, sheet.top) || rect.bottom > innerHeight || panel.scrollWidth > panel.clientWidth + 1) throw new Error('Expanded hint exceeds visible viewport: ' + JSON.stringify({top:rect.top,bottom:rect.bottom,height:innerHeight}));
      const scroller = panel.querySelector('.source-filter-body');
      if (scroller.clientHeight <= 0 || scroller.scrollHeight <= scroller.clientHeight) throw new Error('Long context is not reachable by scrolling');
    })()`);
  }
  await client.call("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await evaluate(client, `(() => {
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    const sizes = [panel, ...panel.querySelectorAll('*')].map((element) => [element, parseFloat(getComputedStyle(element).fontSize)]);
    for (const [element, size] of sizes) element.style.fontSize = (size * 2) + 'px';
    window.dispatchEvent(new Event('resize'));
    const rect = panel.getBoundingClientRect();
    if (panel.scrollWidth > panel.clientWidth + 1 || rect.bottom > innerHeight) throw new Error('Doubled text clipped the source panel');
    document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-trigger').focus();
  })()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
  await evaluate(client, `(() => {
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    const rect = document.activeElement.getBoundingClientRect();
    const bounds = panel.querySelector('.source-filter-body').getBoundingClientRect();
    if (!document.activeElement.matches('.enhanced-select-option') || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) throw new Error('Keyboard focus is outside the scroller');
    if (panel.querySelector('.source-context-toggle').getAttribute('aria-expanded') !== 'true') throw new Error('Keyboard navigation collapsed context');
  })()`);
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await evaluate(client, `(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('event') || params.get('year') !== 'value:2025' || params.get('q') !== ${JSON.stringify(longSearch)}) throw new Error('Removing unavailable source changed unrelated filters');
    if (!document.activeElement.matches('.enhanced-select-trigger')) throw new Error('Removing unavailable source lost focus');
    const panel = document.querySelector('#sourceEventFilter').closest('label').querySelector('.enhanced-select-panel');
    if (panel.querySelector('.source-filter-body').scrollTop === 0 || panel.querySelector('.source-filter-context').hidden) throw new Error('Selection reset scroll position or context');
  })()`);
  const mobile = await client.call("Page.captureScreenshot", { format: "png" });
  await writeFile("tmp/source-filter-implementation/hint-mobile-stress.png", Buffer.from(mobile.data, "base64"));
  await evaluate(client, `(async () => {
    const { createSourceIndex, availableSourceValues } = await import('./source-filters.js');
    const { updateSourceControls } = await import('./controls.js');
    const registry = await fetch('./data/interface-registry.json').then((response) => response.json());
    const photos = [{ photo_id: 'known', album_ids: ['known'] }];
    const sourceIndex = createSourceIndex(photos, [{ album_id: 'known', event_name: 'Camp', event_year: '2025' }]);
    const controls = Object.fromEntries(['sourceEvent', 'sourceYear', 'album'].map((key) => [key, document.querySelector('#' + key + 'Filter')]));
    const filters = { sourceYear: ['missing:'] };
    updateSourceControls({ controls, sourceIndex, filters, available: availableSourceValues(sourceIndex, photos, filters) });
    const expected = registry.pages.filters.find((filter) => filter.key === 'sourceYear').missingLabel;
    if (controls.sourceYear.selectedOptions[0]?.textContent !== expected) throw new Error('Retained unknown year lost its field label');
    const option = controls.sourceYear.closest('label').querySelector('[data-value="missing:"]');
    if (option.disabled || !option.textContent.includes('無相符照片')) throw new Error('Retained unknown year lost its removable zero-match state');
  })()`);
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
    await runSourceSmoke(client, `http://127.0.0.1:${appPort}/`);
    await runSourceHintSmoke(client, `http://127.0.0.1:${appPort}/`);
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
