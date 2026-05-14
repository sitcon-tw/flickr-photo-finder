import react from "@vitejs/plugin-react";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const outputDir = resolve(import.meta.dirname, "..", process.env.PAGES_REACT_OUT_DIR || "tmp/pages-react");
const includeFixtures = process.env.PAGES_REACT_INCLUDE_FIXTURES !== "0";

const publicFiles = [
  "config/project.json",
  "data/interface-registry.json",
  "data/photo-schema.json",
  "data/search-aliases.json",
  "data/tag-taxonomy.json",
];
const fixtureFiles = ["fixtures/albums.csv", "fixtures/photos.csv"];

async function copyIntoPreviewArtifact(sourcePath: string, outputRoot: string) {
  const destination = join(outputRoot, sourcePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(import.meta.dirname, "..", sourcePath), destination);
}

function previewDataContractsPlugin(): Plugin {
  return {
    name: "preview-data-contracts",
    async closeBundle() {
      for (const file of includeFixtures ? [...publicFiles, ...fixtureFiles] : publicFiles) {
        await copyIntoPreviewArtifact(file, outputDir);
      }
      if (includeFixtures) {
        await writeFile(
          join(outputDir, "config.js"),
          `export const projectConfigUrl = "./config/project.json";

export const dataSources = {
  albumsCsvUrl: "./fixtures/albums.csv",
  photosCsvUrl: "./fixtures/photos.csv",
  interfaceRegistryJsonUrl: "./data/interface-registry.json",
  schemaJsonUrl: "./data/photo-schema.json",
  searchAliasesJsonUrl: "./data/search-aliases.json",
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
};
`,
        );
      }
      await writeFile(join(outputDir, ".nojekyll"), "");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), previewDataContractsPlugin()],
  root: import.meta.dirname,
  build: {
    emptyOutDir: true,
    outDir: outputDir,
    sourcemap: false,
  },
});
