import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { ClaimsAuthClient } from "./contracts";
import {
  updateSupabaseSession,
  type SupabaseProxyClientFactory,
} from "./proxy";

const credentials = {
  url: "https://project.supabase.co",
  publishableKey: "publishable-key",
};

describe("updateSupabaseSession", () => {
  it("verifies browsing sessions without ever creating anonymous Auth", async () => {
    const signInAnonymously = vi.fn();
    const getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    const factory: SupabaseProxyClientFactory = vi.fn(() => {
      return {
        auth: { getClaims, signInAnonymously },
      } as unknown as ClaimsAuthClient;
    });

    await updateSupabaseSession(
      new NextRequest("https://emanowa.test/w/2027"),
      credentials,
      factory,
    );

    expect(getClaims).toHaveBeenCalledOnce();
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("forwards refreshed cookies and mandatory cache headers", async () => {
    const factory: SupabaseProxyClientFactory = vi.fn(
      (_url, _key, options) =>
        ({
          auth: {
            getClaims: vi.fn(async () => {
              options.cookies.setAll(
                [
                  {
                    name: "sb-token",
                    value: "refreshed",
                    options: { httpOnly: true, path: "/" },
                  },
                ],
                {
                  "Cache-Control":
                    "private, no-cache, no-store, must-revalidate, max-age=0",
                  Expires: "0",
                  Pragma: "no-cache",
                },
              );
              return { data: null, error: null };
            }),
          },
        }) as unknown as ClaimsAuthClient,
    );

    const response = await updateSupabaseSession(
      new NextRequest("https://emanowa.test/me"),
      credentials,
      factory,
    );

    expect(response.cookies.get("sb-token")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("passes through without contacting Auth when it is unconfigured", async () => {
    const factory: SupabaseProxyClientFactory = vi.fn();
    const response = await updateSupabaseSession(
      new NextRequest("https://emanowa.test/about"),
      null,
      factory,
    );

    expect(response.status).toBe(200);
    expect(factory).not.toHaveBeenCalled();
  });
});
