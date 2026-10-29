import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReport: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  enforceActorRateLimit: vi.fn(),
  getServerRuntimeConfig: vi.fn(),
  getVerifiedActor: vi.fn(),
  requireWriteConfiguration: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/reports/repository", () => ({
  createReport: mocks.createReport,
}));
vi.mock("@/server/rate-limit/enforce", () => ({
  enforceActorRateLimit: mocks.enforceActorRateLimit,
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/server/auth/session", () => ({
  getVerifiedActor: mocks.getVerifiedActor,
}));
vi.mock("@/server/config", () => ({
  getServerRuntimeConfig: mocks.getServerRuntimeConfig,
  requireWriteConfiguration: mocks.requireWriteConfiguration,
}));

import { ApiRouteError } from "@/server/api/errors";

import { POST } from "./route";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";

function request(
  body: unknown = { reason: "spam" },
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request(
      `https://emanowa.test/api/v1/worlds/2027/emas/${PUBLIC_ID}/reports`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          Origin: "https://emanowa.test",
          ...headers,
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ slug: "2027", id: PUBLIC_ID }) },
  );
}

describe("通報route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerRuntimeConfig.mockReturnValue({
      appOrigin: "https://emanowa.test",
    });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: {} });
    mocks.getVerifiedActor.mockResolvedValue({
      uid: ACTOR_ID,
      isAnonymous: true,
    });
    mocks.enforceActorRateLimit.mockResolvedValue(undefined);
    mocks.createReport.mockResolvedValue({
      receipt: { reportId: REPORT_ID, accepted: true },
      httpStatus: 201,
      replayed: false,
    });
  });

  it("認証・共有制限を通して新規通報の最小receiptを201で返す", async () => {
    const response = await request({ reason: "other", detail: "補足" });

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(await response.json()).toEqual({
      reportId: REPORT_ID,
      accepted: true,
    });
    expect(mocks.enforceActorRateLimit).toHaveBeenCalledWith(
      "report",
      ACTOR_ID,
    );
    expect(mocks.createReport).toHaveBeenCalledWith(
      ACTOR_ID,
      "2027",
      PUBLIC_ID,
      { reason: "other", detail: "補足" },
      IDEMPOTENCY_KEY,
    );
  });

  it("同じ人の既存open通報は同じreceiptを200で返す", async () => {
    mocks.createReport.mockResolvedValue({
      receipt: { reportId: REPORT_ID, accepted: true },
      httpStatus: 200,
      replayed: true,
    });
    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reportId: REPORT_ID,
      accepted: true,
    });
  });

  it("未認証・未知入力・cross-originは制限消費やDB保存へ進めない", async () => {
    mocks.getVerifiedActor.mockResolvedValueOnce(null);
    const unauthenticated = await request();
    expect(unauthenticated.status).toBe(401);

    const unknownInput = await request({ reason: "spam", ownerId: ACTOR_ID });
    expect(unknownInput.status).toBe(422);

    const crossOrigin = await request(
      { reason: "spam" },
      { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    );
    expect(crossOrigin.status).toBe(403);
    expect(mocks.enforceActorRateLimit).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("制限超過時は429と再試行時間を返しDB保存しない", async () => {
    mocks.enforceActorRateLimit.mockRejectedValue(
      new ApiRouteError("RATE_LIMITED", "時間をおいて再試行してください。", {
        retryAfterSeconds: 120,
      }),
    );
    const response = await request();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryAfterSeconds: 120 },
    });
    expect(mocks.createReport).not.toHaveBeenCalled();
  });
});
