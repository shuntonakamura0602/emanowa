import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceImageRateLimit: vi.fn(),
  getPublicEma: vi.fn(),
  renderEmaImage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/ema/repository", () => ({
  getPublicEma: mocks.getPublicEma,
}));
vi.mock("@/server/rate-limit/enforce", () => ({
  enforceImageRateLimit: mocks.enforceImageRateLimit,
}));
vi.mock("@/server/share/ema-image", () => ({
  renderEmaImage: mocks.renderEmaImage,
}));

import { GET } from "./route";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const EMA = {
  publicId: PUBLIC_ID,
  worldSlug: "2027",
  x: 10,
  y: 20,
  slotNumber: 20_011,
  nickname: "段階G",
  category: "other",
  designId: "basic_wood",
  visibility: "public",
  messageVisibility: "public",
  messageText: "画像生成失敗時にも公開本文をエラーへ含めない",
  version: 1,
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
} as const;

function request(): Promise<Response> {
  return GET(
    new Request(
      `https://emanowa.test/api/v1/worlds/2027/emas/${PUBLIC_ID}/image?variant=og`,
    ),
    { params: Promise.resolve({ slug: "2027", id: PUBLIC_ID }) },
  );
}

describe("共有画像routeの障害回復", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceImageRateLimit.mockResolvedValue(undefined);
    mocks.getPublicEma.mockResolvedValue(EMA);
    mocks.renderEmaImage.mockResolvedValue(
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
  });

  it("画像生成失敗をno-storeの503にし、本文や内部エラーを返さない", async () => {
    mocks.renderEmaImage.mockRejectedValue(
      new Error(`renderer failed: ${EMA.messageText}`),
    );

    const response = await request();
    const bodyText = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(bodyText).toContain("TEMPORARILY_UNAVAILABLE");
    expect(bodyText).not.toContain(EMA.messageText);
    expect(bodyText).not.toContain("renderer failed");
  });

  it("生成後に公開状態を確認できなければ古い画像を返さない", async () => {
    mocks.getPublicEma.mockResolvedValueOnce(EMA).mockResolvedValueOnce(null);

    const response = await request();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});
