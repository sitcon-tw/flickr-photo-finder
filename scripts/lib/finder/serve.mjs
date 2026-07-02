import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { appTitle } from "../core/project-config.mjs";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const appRootFiles = new Set(["config.js", "data-utils.js", "main.js", "styles.css", "task-modes.js"]);

function isInsideRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function resolveRequestPath(urlPath, { root, serveAppRoot }) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const requestPath = decodedPath.replace(/^\/+/, "");
  const relativePath = serveAppRoot
    ? decodedPath === "/"
      ? "app/"
      : appRootFiles.has(requestPath)
        ? `app/${requestPath}`
        : requestPath
    : requestPath || ".";
  const absolutePath = resolve(root, normalize(relativePath));

  if (!isInsideRoot(absolutePath, root)) {
    return null;
  }

  return absolutePath;
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

export function startStaticServer({
  rootDir = ".",
  host = process.env.HOST ?? "127.0.0.1",
  onListen,
  port = Number(process.env.PORT ?? 4173),
  title = appTitle,
  serveAppRoot = false,
} = {}) {
  const root = resolve(rootDir);
  const server = createServer(async (request, response) => {
    const filePath = resolveRequestPath(request.url ?? "/", { root, serveAppRoot });
    if (!filePath) {
      sendText(response, 403, "Forbidden");
      return;
    }

    try {
      let targetPath = filePath;
      let fileStat = await stat(targetPath);
      if (fileStat.isDirectory()) {
        const requestPath = request.url?.split("?")[0] ?? "/";
        if (!requestPath.endsWith("/")) {
          response.writeHead(301, { location: `${requestPath}/` });
          response.end();
          return;
        }
        targetPath = join(targetPath, "index.html");
        fileStat = await stat(targetPath);
      }

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
    console.error(`Could not start server on http://${host}:${port}/: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    if (onListen) {
      onListen({ host, port, title });
      return;
    }
    console.log(`${title} is running at http://${host}:${port}/`);
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startStaticServer({
    rootDir: ".",
    serveAppRoot: true,
  });
}
