import { describe, expect, it } from "vitest";

import {
  assertSameOrigin,
  readCreateEmaInput,
  readIdempotencyKey,
} from "@/server/api/request";

const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";
const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";

function createRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/v1/worlds/2027/emas", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "idempotency-key": IDEMPOTENCY_KEY,
      ...headers,
    },
  });
}

const validBody = JSON.stringify({
  x: 10,
  y: 20,
  wishText: "願いが叶いますように",
  nickname: null,
  category: "other",
  designId: "basic_wood",
  visibility: "public",
  messageVisibility: "public",
});

describe("API request boundary", () => {
  it("accepts same-origin JSON and a UUID v4 idempotency key", async () => {
    const request = createRequest(validBody);
    expect(() =>
      assertSameOrigin(request, "http://localhost:3000"),
    ).not.toThrow();
    expect(readIdempotencyKey(request)).toBe(IDEMPOTENCY_KEY);
    await expect(readCreateEmaInput(request)).resolves.toMatchObject({
      x: 10,
      y: 20,
      wishText: "願いが叶いますように",
    });
  });

  it("rejects cross-origin and missing server origin", () => {
    const request = createRequest(validBody, {
      origin: "https://evil.example",
    });
    expect(() => assertSameOrigin(request, "http://localhost:3000")).toThrow();
    expect(() => assertSameOrigin(request, null)).toThrow();
  });

  it("rejects a cross-site fetch even when Origin matches", () => {
    const request = createRequest(validBody, {
      "sec-fetch-site": "cross-site",
    });
    expect(() => assertSameOrigin(request, "http://localhost:3000")).toThrow();
  });

  it("rejects unknown owner fields instead of accepting client ownership", async () => {
    const request = createRequest(
      JSON.stringify({ ...JSON.parse(validBody), ownerId: PUBLIC_ID }),
    );
    await expect(readCreateEmaInput(request)).rejects.toThrow();
  });

  it("rejects oversized, malformed, and non-JSON requests", async () => {
    await expect(
      readCreateEmaInput(createRequest("x".repeat(8 * 1_024 + 1))),
    ).rejects.toThrow();
    await expect(readCreateEmaInput(createRequest("{"))).rejects.toThrow();
    await expect(
      readCreateEmaInput(
        createRequest(validBody, { "content-type": "text/plain" }),
      ),
    ).rejects.toThrow();
    await expect(
      readCreateEmaInput(
        createRequest(validBody, {
          "content-type": "application/json-patch+json",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects invalid and oversized declared Content-Length values", async () => {
    await expect(
      readCreateEmaInput(createRequest(validBody, { "content-length": "-1" })),
    ).rejects.toThrow();
    await expect(
      readCreateEmaInput(createRequest(validBody, { "content-length": "1.5" })),
    ).rejects.toThrow();
    await expect(
      readCreateEmaInput(
        createRequest(validBody, {
          "content-length": String(8 * 1_024 + 1),
        }),
      ),
    ).rejects.toThrow();
  });
});
