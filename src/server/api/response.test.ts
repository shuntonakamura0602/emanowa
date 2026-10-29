import { describe, expect, it } from "vitest";

import { ApiRouteError } from "@/server/api/errors";
import {
  apiErrorResponse,
  boundedPublicJsonResponse,
  jsonResponse,
  publicOverviewJsonResponse,
  serializedJsonBytes,
} from "@/server/api/response";

describe("public response cache boundaries", () => {
  it("returns matching Retry-After header and JSON for rate limits", async () => {
    const response = apiErrorResponse(
      new ApiRouteError(
        "RATE_LIMITED",
        "少し時間をおいて、もう一度お試しください。",
        { retryAfterSeconds: 37 },
      ),
      "private",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect((await response.json()).error.retryAfterSeconds).toBe(37);
  });

  it("keeps ordinary public data such as chunks and feeds no-store", () => {
    const response = jsonResponse({ cells: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows only the content-free overview a bounded shared cache", () => {
    const response = publicOverviewJsonResponse({
      cellSize: 20,
      cells: [],
      asOf: "2026-12-20T00:00:00Z",
    });
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=30, must-revalidate",
    );
  });

  it("measures UTF-8 bytes and fails a chunk response closed above its bound", async () => {
    const body = { message: "願".repeat(4) };
    expect(serializedJsonBytes(body)).toBe(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    );
    const response = boundedPublicJsonResponse(body, 1024);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(() => boundedPublicJsonResponse(body, 1)).toThrowError(
      /地図データが大きいため/u,
    );
  });
});
