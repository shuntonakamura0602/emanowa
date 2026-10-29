import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { moderationInputSchema } from "./contracts";
import { readAdminJsonInput } from "./request";

function request(body: string, contentType = "application/json"): Request {
  return new Request("https://emanowa.test/api/v1/admin/emas/id/moderation", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("admin JSON input", () => {
  it("reads strict bounded JSON", async () => {
    await expect(
      readAdminJsonInput(
        request(
          JSON.stringify({
            action: "hide",
            reasonCode: "spam",
            expectedVersion: 1,
          }),
        ),
        moderationInputSchema,
      ),
    ).resolves.toEqual({
      action: "hide",
      reasonCode: "spam",
      expectedVersion: 1,
    });
  });

  it("rejects non-JSON, unknown keys and oversized streamed bodies", async () => {
    await expect(
      readAdminJsonInput(request("{}", "text/plain"), moderationInputSchema),
    ).rejects.toThrow();
    await expect(
      readAdminJsonInput(
        request(
          JSON.stringify({
            action: "hide",
            reasonCode: "spam",
            expectedVersion: 1,
            actorId: "11111111-1111-4111-8111-111111111111",
          }),
        ),
        moderationInputSchema,
      ),
    ).rejects.toThrow();
    await expect(
      readAdminJsonInput(
        request(JSON.stringify("x".repeat(9_000))),
        moderationInputSchema,
      ),
    ).rejects.toThrow();
  });
});
