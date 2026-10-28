import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./owner-dashboard.tsx", import.meta.url),
  "utf8",
);

describe("OwnerDashboardの編集URL所有権契約", () => {
  it("publicId不一致をprivate stateへ保存する前に拒否する", () => {
    const mismatchCheck = source.indexOf(
      "!isExpectedOwnerPublicId(expectedPublicId, parsed.data.publicId)",
    );
    const privateStateWrite = source.indexOf("setCurrentEma(parsed.data)");
    expect(mismatchCheck).toBeGreaterThan(-1);
    expect(privateStateWrite).toBeGreaterThan(mismatchCheck);
    expect(source).toContain("emaMatchesExpectedPublicId");
    expect(source).toContain("別の利用者の内容は表示していません");
  });
});
