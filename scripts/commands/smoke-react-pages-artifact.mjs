import { spawn } from "node:child_process";

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
    return { help: true, url: defaultUrl };
  }
  if (args.length > 1) {
    throw new Error(`Expected at most one URL, got ${args.length}`);
  }
  return { help: false, url: args[0] ?? defaultUrl };
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

  const dom = await run("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--virtual-time-budget=3000",
    "--dump-dom",
    options.url,
  ]);
  assertIncludes(dom, "30 張照片", "fixture photo count");
  assertIncludes(dom, "101 個相簿", "fixture album count");
  assertIncludes(dom, "photo-card", "photo card markup");
  assertIncludes(dom, "https://www.flickr.com/photos/sitcon/", "Flickr photo links");
  console.log(`React preview smoke passed: ${options.url}`);
}

try {
  await main();
} catch (error) {
  console.error(`React preview smoke failed: ${error.message}`);
  process.exitCode = 1;
}
