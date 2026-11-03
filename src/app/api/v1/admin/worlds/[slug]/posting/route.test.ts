import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  getAdminWorldPosting: vi.fn(),
  getServerRuntimeConfig: vi.fn(),
  requireVerifiedAdminActorFromClient: vi.fn(),
  setAdminWorldPosting: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerRuntimeConfig: mocks.getServerRuntimeConfig,
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/server/admin/auth", () => ({
  requireVerifiedAdminActorFromClient:
    mocks.requireVerifiedAdminActorFromClient,
}));
vi.mock("@/server/admin/repository", () => ({
  getAdminWorldPosting: mocks.getAdminWorldPosting,
  setAdminWorldPosting: mocks.setAdminWorldPosting,
}));

import { ApiRouteError } from "@/server/api/errors";

import { GET, PATCH } from "./route";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";
const world = {
  worldSlug: "2027",
  worldName: "2027年のえまのわ",
  state: "preview",
  postingEnabled: true,
  opensAt: "2026-12-19T15:00:00.000Z",
  closesAt: "2027-12-31T15:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
} as const;

function patchRequest(
  body: unknown = {
    postingEnabled: false,
    reasonCode: "incident",
    expectedPostingEnabled: true,
  },
  headers: Record<string, string> = {},
): Promise<Response> {
  return PATCH(
    new Request("https://emanowa.test/api/v1/admin/worlds/2027/posting", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
        Origin: "https://emanowa.test",
        "Sec-Fetch-Site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: "2027" }) },
  );
}

describe("admin world posting route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerRuntimeConfig.mockReturnValue({
      adminOperationsAvailable: true,
      appOrigin: "https://emanowa.test",
      supabase: { configured: true },
      database: { adminConfigured: true },
    });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: {} });
    mocks.requireVerifiedAdminActorFromClient.mockResolvedValue({
      uid: ACTOR_ID,
    });
    mocks.getAdminWorldPosting.mockResolvedValue(world);
    mocks.setAdminWorldPosting.mockResolvedValue({
      ...world,
      postingEnabled: false,
      updatedAt: "2026-11-03T00:01:00.000Z",
    });
  });

  it("returns the AAL2 administrator-only operational DTO without caching", async () => {
    const response = await GET(
      new Request("https://emanowa.test/api/v1/admin/worlds/2027/posting"),
      { params: Promise.resolve({ slug: "2027" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(await response.json()).toEqual({ world });
    expect(mocks.getAdminWorldPosting).toHaveBeenCalledWith(ACTOR_ID, "2027");
  });

  it("pauses only new posting with same-origin and idempotency protection", async () => {
    const response = await patchRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      world: {
        ...world,
        postingEnabled: false,
        updatedAt: "2026-11-03T00:01:00.000Z",
      },
    });
    expect(mocks.setAdminWorldPosting).toHaveBeenCalledWith(
      ACTOR_ID,
      "2027",
      {
        postingEnabled: false,
        reasonCode: "incident",
        expectedPostingEnabled: true,
      },
      IDEMPOTENCY_KEY,
    );
  });

  it("rejects cross-origin, free-form reasons, and non-AAL2 actors before mutation", async () => {
    const crossOrigin = await patchRequest(undefined, {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(crossOrigin.status).toBe(403);

    const invalidReason = await patchRequest({
      postingEnabled: false,
      reasonCode: "the submitted ema contained private text",
      expectedPostingEnabled: true,
    });
    expect(invalidReason.status).toBe(422);

    mocks.requireVerifiedAdminActorFromClient.mockRejectedValueOnce(
      new ApiRouteError("ADMIN_REQUIRED", "管理操作にはMFA認証が必要です。"),
    );
    const nonAal2 = await patchRequest();
    expect(nonAal2.status).toBe(403);
    expect(mocks.setAdminWorldPosting).not.toHaveBeenCalled();
  });

  it("does not depend on publication approval or ordinary write services", async () => {
    mocks.getServerRuntimeConfig.mockReturnValue({
      adminOperationsAvailable: true,
      appOrigin: "https://emanowa.test",
      supabase: { configured: true },
      database: { adminConfigured: true },
      publicationReady: false,
      writesAvailable: false,
    });

    const response = await patchRequest();
    expect(response.status).toBe(200);
    expect(mocks.setAdminWorldPosting).toHaveBeenCalledOnce();
  });
});
