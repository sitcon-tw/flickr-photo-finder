import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { startStaticServer } from "../lib/finder/serve.mjs";

const defaultUrl = "http://127.0.0.1:4932/";

function printUsage() {
  console.log(`Usage:
  node scripts/commands/smoke-react-pages-artifact.mjs [url]

Runs a headless Chrome smoke check against the React preview artifact URL.
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for React preview server: ${url}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`React preview smoke did not find ${label}: ${expected}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const serverPort = options.url ? null : await findOpenPort();
  const server = serverPort
    ? startStaticServer({ rootDir: "tmp/pages-react", port: serverPort, title: "React preview smoke" })
    : null;
  const targetUrl = options.url ?? `http://127.0.0.1:${serverPort}/`;
  if (server) {
    await waitForHttp(targetUrl);
  }
  try {
    const dom = await run("google-chrome", [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=3000",
      "--dump-dom",
      targetUrl,
    ]);
    assertIncludes(dom, "30 / 30 張照片", "fixture filtered photo count");
    assertIncludes(dom, "101 個相簿", "fixture album count");
    assertIncludes(dom, "可放字、品牌露出、友善交流、舞台講者", "search placeholder");
    assertIncludes(dom, "探索更多", "sort control");
    assertIncludes(dom, "社群貼文", "task mode control");
    assertIncludes(dom, "主要篩選", "primary filter controls");
    assertIncludes(dom, "候選 0", "candidate panel");
    assertIncludes(dom, "顯示前 12 張", "visible result summary");
    assertIncludes(dom, "photo-card", "photo card markup");
    assertIncludes(dom, "photo-card__preview", "photo preview entry");
    assertIncludes(dom, "https://www.flickr.com/photos/sitcon/", "Flickr photo links");
    console.log(`React preview smoke passed: ${targetUrl}`);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`React preview smoke failed: ${error.message}`);
  process.exitCode = 1;
}
