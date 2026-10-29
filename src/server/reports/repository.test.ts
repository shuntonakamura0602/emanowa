import { beforeEach, describe, expect, it, vi } from "vitest";

const { withDatabaseTransaction } = vi.hoisted(() => ({
  withDatabaseTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/transaction", () => ({ withDatabaseTransaction }));

import {
  createReport,
  createReportRequestHash,
  queryCreateReport,
} from "./repository";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";

describe("通報repository", () => {
  beforeEach(() => withDatabaseTransaction.mockReset());

  it("actorをtransaction-localに渡し、最小receiptとDBのstatusを返す", async () => {
    withDatabaseTransaction.mockResolvedValue({
      report_id: REPORT_ID,
      accepted: true,
      replayed: false,
      http_status: 201,
    });

    await expect(
      createReport(
        ACTOR_ID,
        "2027",
        PUBLIC_ID,
        { reason: "other", detail: "  補足  " },
        IDEMPOTENCY_KEY,
      ),
    ).resolves.toEqual({
      receipt: { reportId: REPORT_ID, accepted: true },
      httpStatus: 201,
      replayed: false,
    });
    expect(withDatabaseTransaction).toHaveBeenCalledWith(
      { actorId: ACTOR_ID },
      expect.any(Function),
    );
  });

  it("DB関数へ正規化した入力とrequest hashだけを渡す", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          report_id: REPORT_ID,
          accepted: true,
          replayed: false,
          http_status: 201,
        },
      ],
    });
    const hash = createReportRequestHash("2027", PUBLIC_ID, {
      reason: "other",
      detail: "補足",
    });

    await expect(
      queryCreateReport(
        { query } as never,
        "2027",
        PUBLIC_ID,
        { reason: "other", detail: "補足" },
        IDEMPOTENCY_KEY,
        hash,
      ),
    ).resolves.toMatchObject({ report_id: REPORT_ID, http_status: 201 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("app_private.create_report"),
      ["2027", PUBLIC_ID, "other", "補足", IDEMPOTENCY_KEY, hash],
    );
  });

  it("path・理由・補足をhashへ含め、空補足をnullと同じ正規形にする", () => {
    const withoutDetail = createReportRequestHash("2027", PUBLIC_ID, {
      reason: "spam",
    });
    const emptyDetail = createReportRequestHash("2027", PUBLIC_ID, {
      reason: "spam",
      detail: "",
    });
    const differentReason = createReportRequestHash("2027", PUBLIC_ID, {
      reason: "harassment",
    });

    expect(withoutDetail.equals(emptyDetail)).toBe(true);
    expect(withoutDetail.equals(differentReason)).toBe(false);
  });
});
