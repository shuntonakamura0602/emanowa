import { describe, expect, it } from "vitest";

import { ApiRouteError } from "@/server/api/errors";

import { readCreateReportInput } from "./input";

function request(body: string, contentType = "application/json"): Request {
  return new Request("https://emanowa.test/api/report", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

describe("通報入力reader", () => {
  it("有効なJSONを正規化して返す", async () => {
    await expect(
      readCreateReportInput(
        request(JSON.stringify({ reason: "spam", detail: "  補足  " })),
      ),
    ).resolves.toEqual({ reason: "spam", detail: "補足" });
  });

  it("未知キー、危険な制御文字、上限超過を拒否する", async () => {
    await expect(
      readCreateReportInput(
        request(JSON.stringify({ reason: "spam", ownerId: "attacker" })),
      ),
    ).rejects.toThrow();
    await expect(
      readCreateReportInput(
        request(JSON.stringify({ reason: "other", detail: "補足\u0000" })),
      ),
    ).rejects.toThrow();
    await expect(
      readCreateReportInput(
        request(JSON.stringify({ reason: "other", detail: "願".repeat(201) })),
      ),
    ).rejects.toThrow();
  });

  it("JSON以外と8KiBを超える本文をDB処理前に拒否する", async () => {
    await expect(
      readCreateReportInput(request("{}", "text/plain")),
    ).rejects.toBeInstanceOf(ApiRouteError);
    await expect(
      readCreateReportInput(
        request(JSON.stringify({ reason: "other", extra: "a".repeat(8_192) })),
      ),
    ).rejects.toBeInstanceOf(ApiRouteError);
  });
});
