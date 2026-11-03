import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("liveness health route", () => {
  it("reports only process liveness without caching", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({ status: "live" });
  });
});
