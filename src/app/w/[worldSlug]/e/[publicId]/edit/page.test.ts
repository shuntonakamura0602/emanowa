import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("本人編集ルート", () => {
  it("URLのpublicIdをOwnerDashboardの所有権照合へ渡す", () => {
    expect(source).toContain("<OwnerDashboard");
    expect(source).toContain("expectedPublicId={publicId}");
    expect(source).not.toContain("認証処理が未接続");
  });
});
