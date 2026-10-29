import { describe, expect, it, vi } from "vitest";

import { submitReportCommand } from "./command";

const command = {
  actorId: "11111111-1111-4111-8111-111111111111",
  worldSlug: "2027",
  publicId: "550e8400-e29b-41d4-a716-446655440000",
  input: { reason: "spam" as const },
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
};

describe("通報command", () => {
  it("共有レート制限を通過してからだけDBへ保存する", async () => {
    const order: string[] = [];
    const result = await submitReportCommand(command, {
      enforceRateLimit: vi.fn(async () => {
        order.push("limit");
      }),
      createReport: vi.fn(async () => {
        order.push("database");
        return {
          receipt: {
            reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            accepted: true as const,
          },
          httpStatus: 201 as const,
          replayed: false,
        };
      }),
    });

    expect(order).toEqual(["limit", "database"]);
    expect(result.httpStatus).toBe(201);
  });

  it("制限基盤の拒否・障害時はDB保存へ進まない", async () => {
    const createReport = vi.fn();
    await expect(
      submitReportCommand(command, {
        enforceRateLimit: vi.fn().mockRejectedValue(new Error("limited")),
        createReport,
      }),
    ).rejects.toThrow("limited");
    expect(createReport).not.toHaveBeenCalled();
  });
});
