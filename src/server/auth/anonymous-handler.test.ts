import { describe, expect, it, vi } from "vitest";

import type { AnonymousAuthClient } from "@/server/supabase/contracts";

import {
  createAnonymousSessionHandler,
  type AnonymousEndpointConfig,
} from "./anonymous-handler";

const UID = "11111111-1111-4111-8111-111111111111";

const developmentConfig: AnonymousEndpointConfig = {
  environment: "development",
  appOrigin: "https://emanowa.test",
  supabase: {
    url: "https://project.supabase.co",
    publishableKey: "publishable-key",
    configured: true,
  },
  captcha: { configured: false, required: false },
};

function mockClient(claimsResult: unknown): AnonymousAuthClient {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue(claimsResult),
      signInAnonymously: vi.fn().mockResolvedValue({
        data: { user: { id: UID } },
        error: null,
      }),
    },
  } as unknown as AnonymousAuthClient;
}

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://emanowa.test/api/v1/auth/anonymous", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://emanowa.test",
      ...headers,
    },
    body,
  });
}

function handler(
  config: AnonymousEndpointConfig = developmentConfig,
  client = mockClient({ data: null, error: null }),
) {
  const createClient = vi.fn(() => client);
  return {
    createClient,
    POST: createAnonymousSessionHandler({
      getConfig: () => config,
      createClient,
      createRequestId: () => "request-1",
    }),
  };
}

describe("anonymous session endpoint", () => {
  it("creates a session only on an explicit valid POST", async () => {
    const { POST } = handler();
    const response = await POST(request('{"captchaToken":"token"}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      isAnonymous: true,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects ownerId and every other unknown field before Auth", async () => {
    const { POST, createClient } = handler();
    const response = await POST(request(`{"ownerId":"${UID}"}`));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { ownerId: "受け付けていない項目が含まれています。" },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before Auth", async () => {
    const { POST, createClient } = handler();
    const response = await POST(
      request("{}", {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires application/json", async () => {
    const { POST, createClient } = handler();
    const response = await POST(
      request("{}", { "content-type": "text/plain" }),
    );

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a body larger than 8 KiB", async () => {
    const { POST, createClient } = handler();
    const response = await POST(
      request(JSON.stringify({ x: "a".repeat(8_192) })),
    );

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails closed when CAPTCHA configuration is missing publicly", async () => {
    const config: AnonymousEndpointConfig = {
      ...developmentConfig,
      environment: "production",
      captcha: { configured: false, required: true },
    };
    const { POST, createClient } = handler(config);
    const response = await POST(request('{"captchaToken":"token"}'));

    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails closed when APP_ORIGIN is missing publicly", async () => {
    const config: AnonymousEndpointConfig = {
      ...developmentConfig,
      environment: "production",
      appOrigin: null,
    };
    const { POST, createClient } = handler(config);
    const response = await POST(request("{}"));

    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires a CAPTCHA token in production and staging", async () => {
    const config: AnonymousEndpointConfig = {
      ...developmentConfig,
      environment: "staging",
      captcha: { configured: true, required: true },
    };
    const { POST, createClient } = handler(config);
    const response = await POST(request("{}"));

    expect(response.status).toBe(422);
    expect((await response.json()).error.fieldErrors).toEqual({
      captchaToken: "CAPTCHAトークンを指定してください。",
    });
    expect(createClient).toHaveBeenCalledOnce();
  });

  it("revalidates an existing public session without spending another CAPTCHA token", async () => {
    const config: AnonymousEndpointConfig = {
      ...developmentConfig,
      environment: "production",
      captcha: { configured: true, required: true },
    };
    const client = mockClient({
      data: { claims: { sub: UID, is_anonymous: true } },
      error: null,
    });
    const { POST } = handler(config, client);
    const response = await POST(request("{}"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      isAnonymous: true,
    });
    expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("returns Retry-After and retryAfterSeconds for provider throttling", async () => {
    const client = mockClient({ data: null, error: null });
    vi.mocked(client.auth.signInAnonymously).mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_request_rate_limit", status: 429 },
    } as never);
    const { POST } = handler(developmentConfig, client);
    const response = await POST(request("{}"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()).error.retryAfterSeconds).toBe(60);
  });

  it("returns a fresh-challenge field error when provider CAPTCHA fails", async () => {
    const client = mockClient({ data: null, error: null });
    vi.mocked(client.auth.signInAnonymously).mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "captcha_failed", status: 400 },
    } as never);
    const config: AnonymousEndpointConfig = {
      ...developmentConfig,
      environment: "production",
      captcha: { configured: true, required: true },
    };
    const { POST } = handler(config, client);
    const response = await POST(request('{"captchaToken":"invalid"}'));

    expect(response.status).toBe(422);
    expect(
      (await response.json()).error.fieldErrors.captchaToken,
    ).toBeDefined();
  });
});
