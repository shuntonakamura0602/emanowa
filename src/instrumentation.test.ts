import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "@/instrumentation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server request error instrumentation", () => {
  it("logs only application routing metadata and an opaque digest", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("願い本文を含む秘密の例外"), {
      digest: "opaque-digest-123",
    });

    await onRequestError(
      error,
      {
        path: "/w/2027/e/private-id?token=secret",
        method: "GET",
        headers: { cookie: "session=secret" },
      },
      {
        routerKind: "App Router",
        routePath: "/app/w/[worldSlug]/e/[publicId]/page",
        routeType: "render",
        renderSource: "server-rendering",
        revalidateReason: undefined,
      },
    );

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("/app/w/[worldSlug]/e/[publicId]/page");
    expect(line).toContain("opaque-digest-123");
    expect(line).not.toContain("private-id");
    expect(line).not.toContain("token=secret");
    expect(line).not.toContain("session=secret");
    expect(line).not.toContain("願い本文");
  });
});
