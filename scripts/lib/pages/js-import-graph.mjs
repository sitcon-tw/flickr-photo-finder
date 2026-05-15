import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

function isOutsideRoot(path) {
  const normalized = normalize(path);
  return isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${sep}`);
}

async function assertImportFile(path) {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing imported module: ${path}`);
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`Imported module is not a file: ${path}`);
  }
}

export function relativeJavaScriptImports(source) {
  const imports = new Set();
  const staticPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  const dynamicPattern = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

export async function collectRelativeJavaScriptImportGraph({ rootDir, entryFile }) {
  const visited = new Set();
  const pending = [entryFile];

  while (pending.length > 0) {
    const file = normalize(pending.pop());
    if (isOutsideRoot(file)) {
      throw new Error(`${entryFile} resolved a module outside ${rootDir}: ${file}`);
    }
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);

    const fullPath = join(rootDir, file);
    await assertImportFile(fullPath);
    const source = await readFile(fullPath, "utf8");
    for (const specifier of relativeJavaScriptImports(source)) {
      const importedFile = normalize(join(dirname(file), specifier));
      if (isOutsideRoot(importedFile)) {
        throw new Error(`${file} imports a module outside ${rootDir}: ${specifier}`);
      }
      pending.push(importedFile);
    }
  }

  return [...visited].sort();
}
