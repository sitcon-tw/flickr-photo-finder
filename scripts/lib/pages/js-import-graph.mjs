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

const importPatterns = [
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g,
  /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
];

export function relativeJavaScriptImports(source) {
  const imports = new Set();
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

export function rewriteRelativeJavaScriptImports(source, rewrite) {
  for (const pattern of importPatterns) {
    source = source.replace(pattern, (match, specifier) => match.replace(specifier, () => rewrite(specifier)));
  }
  return source;
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
      const importedFile = normalize(join(dirname(file), specifier.split(/[?#]/)[0]));
      if (isOutsideRoot(importedFile)) {
        throw new Error(`${file} imports a module outside ${rootDir}: ${specifier}`);
      }
      pending.push(importedFile);
    }
  }

  return [...visited].sort();
}
