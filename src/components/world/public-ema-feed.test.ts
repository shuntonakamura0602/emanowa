import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./public-ema-feed.tsx", import.meta.url),
  "utf8",
);

describe("公開一覧component契約", () => {
  it("APIのnextCursorで次の24件へ置換する", () => {
    expect(source).toContain("setNextCursor(page.nextCursor)");
    expect(source).toContain("pageNumberRef.current + 1");
    expect(source).toContain("PUBLIC_FEED_PAGE_SIZE");
    expect(source).not.toContain("advanceBoundedPublicEmaWindow");
  });

  it("30秒周期は可視タブの現在ページcursorを再取得する", () => {
    expect(source).toContain("window.setInterval");
    expect(source).toContain("PUBLIC_FEED_REFRESH_MS");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain("refreshCurrentPage()");
    expect(source).toContain("currentPageCursorRef.current");
    expect(source).toContain("pageNumberRef.current");
    expect(source).toContain("const reload = useCallback");
  });
});
