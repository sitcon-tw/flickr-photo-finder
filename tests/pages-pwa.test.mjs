import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGeneratedAt, pwaStatusText } from "../app/pwa.js";

describe("Pages PWA status helpers", () => {
  it("formats finder-data generatedAt timestamps for status text", () => {
    assert.equal(formatGeneratedAt("2026-05-20T03:04:05.000Z"), "2026-05-20 03:04 UTC");
    assert.equal(formatGeneratedAt("not-an-iso-time"), "not-an-iso-time");
    assert.equal(formatGeneratedAt(""), "");
  });

  it("hides status text during normal online loading", () => {
    assert.equal(pwaStatusText({ online: true, usedCache: false, generatedAt: "2026-05-20T03:04:05.000Z" }), "");
  });

  it("describes offline and cache fallback states", () => {
    assert.equal(
      pwaStatusText({ online: false, usedCache: false, generatedAt: "2026-05-20T03:04:05.000Z" }),
      "離線模式：使用已快取資料，資料時間 2026-05-20 03:04 UTC",
    );
    assert.equal(
      pwaStatusText({ online: true, usedCache: true, generatedAt: "2026-05-20T03:04:05.000Z" }),
      "使用快取資料，資料時間 2026-05-20 03:04 UTC，重新連線後會嘗試更新",
    );
  });
});
