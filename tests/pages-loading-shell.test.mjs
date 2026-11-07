import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderLoadingShell } from "../scripts/commands/build-pages.mjs";

const template = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
const registry = JSON.parse(await readFile(new URL("../data/interface-registry.json", import.meta.url), "utf8"));

test("loading shell follows registry grouping and escapes display text", () => {
  const customized = structuredClone(registry);
  customized.pages.defaultPrimaryFilters = ["peopleCount"];
  customized.pages.filters.find((filter) => filter.key === "sourceEvent").emptyLabel = '活動 <A> & "B"';
  customized.pages.taskModes[0].label = "用途 <A>";
  const html = renderLoadingShell(template, customized);
  const primary = html.split('id="taskFilterGrid"')[1].split('<details id="advancedFilters"')[0];
  const advanced = html.split('id="advancedFilterGrid"')[1].split("</details>")[0];
  assert.match(primary, /id="peopleCountFilter"/);
  assert.doesNotMatch(primary, /id="useFilter"/);
  assert.match(advanced, /id="useFilter"/);
  assert.match(html, /活動 &lt;A&gt; &amp; &quot;B&quot;/);
  assert.match(html, /用途 &lt;A&gt;/);
  for (const { control } of registry.pages.filters) {
    assert.equal(html.split(`id="${control}Filter"`).length - 1, 1, control);
  }
  assert.doesNotMatch(html, /<!-- (primary-filters|advanced-filters)/);
});

test("loading shell rejects a filter without a matching HTML control", () => {
  const customized = structuredClone(registry);
  customized.pages.filters[0].control = "missingControl";
  assert.throws(() => renderLoadingShell(template, customized), /missingControlFilter/);
});

test("loading shell preserves replacement tokens as display text", () => {
  const customized = structuredClone(registry);
  const text = "價格 $$ $& $` $' $1";
  for (const filter of customized.pages.filters) {
    filter.label = text;
    filter.emptyLabel = text;
  }
  customized.pages.taskModes[0].label = text;
  const html = renderLoadingShell(template, customized);
  assert.ok(html.includes(text.replaceAll("&", "&amp;")));
  assert.equal(html.split('id="taskModes"').length - 1, 1);
  for (const { control } of registry.pages.filters) {
    assert.equal(html.split(`id="${control}Filter"`).length - 1, 1, control);
  }
});
