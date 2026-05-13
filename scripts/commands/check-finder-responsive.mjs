import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

function printUsage() {
  console.log(`Usage:
  pnpm finder:responsive:check -- <url>

Example:
  pnpm finder:dev:fixture
  pnpm finder:responsive:check -- http://127.0.0.1:4173/`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true, url: "" };
  }
  return { help: false, url: args[0] ?? "" };
}

async function openBrowser(port, userDataDir) {
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = await response.json();
      if (data.webSocketDebuggerUrl) {
        return { chrome, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
      }
    } catch {
      await delay(100);
    }
  }

  chrome.kill("SIGTERM");
  throw new Error("Chrome DevTools endpoint did not start.");
}

function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(`${method}: ${message.error.message}`));
    } else {
      resolve(message.result);
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId = "") {
          const id = nextId;
          nextId += 1;
          const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
          ws.send(JSON.stringify(payload));
          return new Promise((sendResolve, sendReject) => {
            pending.set(id, { resolve: sendResolve, reject: sendReject, method });
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
  });
}

async function probe(url, viewport) {
  const port = 9820 + Math.floor(Math.random() * 300);
  const userDataDir = `/tmp/finder-responsive-check-${process.pid}-${viewport.width}`;
  rmSync(userDataDir, { force: true, recursive: true });

  const { chrome, webSocketDebuggerUrl } = await openBrowser(port, userDataDir);
  try {
    const browser = await connect(webSocketDebuggerUrl);
    const target = await browser.send("Target.createTarget", { url });
    const attached = await browser.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    const send = (method, params = {}) => browser.send(method, params, sessionId);

    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });

    for (let index = 0; index < 80; index += 1) {
      const result = await send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector(".photo-card"))`,
        returnByValue: true,
      });
      if (result.result.value) {
        break;
      }
      await delay(100);
    }

    const expression = `(() => {
      const isVisible = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const visibleTexts = (selector) => [...document.querySelectorAll(selector)]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .slice(0, 8)
        .map((element) => element.textContent.trim());
      const targetSizes = [...document.querySelectorAll("button")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .slice(0, 16)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return Math.round(Math.min(rect.width, rect.height));
        });
      return {
        width: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        desktopControls: isVisible(".desktop-control-panel"),
        mobileToolbar: isVisible(".mobile-toolbar"),
        mobileBar: isVisible(".mobile-action-bar"),
        sidePanel: isVisible(".desktop-side-panel"),
        cardActions: visibleTexts(".photo-card:first-child .photo-card-actions button"),
        minTarget: Math.min(...targetSizes),
      };
    })()`;

    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Responsive probe failed.");
    }
    await browser.send("Target.closeTarget", { targetId: target.targetId });
    browser.close();
    return result.result.value;
  } finally {
    chrome.kill("SIGTERM");
    rmSync(userDataDir, { force: true, recursive: true });
  }
}

function assertProbe(name, result, expected) {
  if (result.docWidth > result.width) {
    throw new Error(`${name} has horizontal overflow: ${result.docWidth} > ${result.width}`);
  }
  for (const [key, value] of Object.entries(expected.visibility)) {
    if (result[key] !== value) {
      throw new Error(`${name} expected ${key}=${value}, got ${result[key]}`);
    }
  }
  for (const expectedAction of expected.actions) {
    if (!result.cardActions.some((action) => action.includes(expectedAction))) {
      throw new Error(`${name} is missing visible card action: ${expectedAction}`);
    }
  }
  for (const forbiddenAction of expected.forbiddenActions) {
    if (result.cardActions.some((action) => action.includes(forbiddenAction))) {
      throw new Error(`${name} should not show card action: ${forbiddenAction}`);
    }
  }
  if (result.minTarget < expected.minTarget) {
    throw new Error(`${name} touch/click target too small: ${result.minTarget} < ${expected.minTarget}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.url) {
    printUsage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const desktop = await probe(options.url, { width: 1440, height: 900, mobile: false });
  const mobile = await probe(options.url, { width: 390, height: 844, mobile: true });

  assertProbe("desktop", desktop, {
    visibility: {
      desktopControls: true,
      mobileToolbar: false,
      mobileBar: false,
      sidePanel: true,
    },
    actions: ["加候選", "詳情", "Flickr", "大圖", "原圖", "Sheets"],
    forbiddenActions: [],
    minTarget: 38,
  });
  assertProbe("mobile", mobile, {
    visibility: {
      desktopControls: false,
      mobileToolbar: true,
      mobileBar: true,
      sidePanel: false,
    },
    actions: ["加候選", "大圖"],
    forbiddenActions: ["詳情", "Flickr", "原圖", "Sheets"],
    minTarget: 44,
  });

  console.log(JSON.stringify({ desktop, mobile }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
