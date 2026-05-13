import react from "@vitejs/plugin-react";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, normalize } from "node:path";
import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";

const repoStaticFiles = [
  "config/project.json",
  "data/interface-registry.json",
  "data/photo-schema.json",
  "data/search-aliases.json",
  "data/tag-taxonomy.json",
  "fixtures/albums.csv",
  "fixtures/photos.csv",
];

function contentTypeFor(path: string) {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

function repoStaticData(): Plugin {
  const staticFiles = new Set(repoStaticFiles.map((path) => `/${path}`));
  const copyOutputDir = process.env.FINDER_REACT_COPY_OUT_DIR ?? "tmp/pages-react";
  const shouldCopyStaticFiles = process.env.FINDER_REACT_COPY_STATIC !== "0";
  return {
    name: "finder-repo-static-data",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!staticFiles.has(pathname)) {
          next();
          return;
        }
        const filePath = normalize(pathname).replace(/^\/+/, "");
        try {
          const content = await readFile(filePath);
          response.statusCode = 200;
          response.setHeader("Content-Type", contentTypeFor(filePath));
          response.end(content);
        } catch (error) {
          next(error);
        }
      });
    },
    async closeBundle() {
      if (!shouldCopyStaticFiles) {
        return;
      }
      for (const filePath of repoStaticFiles) {
        const target = join(copyOutputDir, filePath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(filePath, target);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: process.env.FINDER_REACT_OUT_DIR ?? "../tmp/pages-react",
  },
  plugins: [react(), repoStaticData()],
  root: "app-react",
});
