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
    expect(createClient).not.toHaveBeenCalled();
  });
});
