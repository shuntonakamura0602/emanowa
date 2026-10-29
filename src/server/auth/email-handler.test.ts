import { describe, expect, it, vi } from "vitest";

import { ApiRouteError } from "@/server/api/errors";
import type { EmailAuthClient } from "@/server/supabase/contracts";

import {
  createEmailEndpointHandler,
  type EmailEndpointConfig,
} from "./email-handler";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER_UID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "owner@example.test";

const config: EmailEndpointConfig = {
  environment: "test",
  appOrigin: "https://emanowa.test",
  supabase: { configured: true },
  captcha: { configured: false, required: false },
};

function user(id = UID, isAnonymous = true) {
  return { id, is_anonymous: isAnonymous };
}

function authClient() {
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: user() },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({
      data: { user: user() },
      error: null,
    }),
    signInWithOtp: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    verifyOtp: vi.fn().mockResolvedValue({
      data: { user: user(UID, false), session: null },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    auth,
    client: { auth } as unknown as EmailAuthClient,
  };
}

function request(
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://emanowa.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://emanowa.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}

function handler(
  kind: "link" | "recover" | "verify" | "signout",
  client = authClient(),
  endpointConfig = config,
) {
  const createClient = vi.fn(() => client.client);
  const releaseOtpReservation = vi.fn().mockResolvedValue(undefined);
  const reserveOtpRateLimit = vi.fn().mockResolvedValue({
    release: releaseOtpReservation,
  });
  const enforceOtpLinkVerificationRateLimit = vi
    .fn()
    .mockResolvedValue(undefined);
  const enforceOtpRecoveryVerificationRateLimit = vi
    .fn()
    .mockResolvedValue(undefined);
  return {
    ...client,
    createClient,
    enforceOtpLinkVerificationRateLimit,
    enforceOtpRecoveryVerificationRateLimit,
    releaseOtpReservation,
    reserveOtpRateLimit,
    POST: createEmailEndpointHandler(kind, {
      getConfig: () => endpointConfig,
      createClient,
      reserveOtpRateLimit,
      enforceOtpLinkVerificationRateLimit,
      enforceOtpRecoveryVerificationRateLimit,
      createRequestId: () => "request-1",
    }),
  };
}

function expectPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(response.headers.get("x-request-id")).toBe("request-1");
}

describe("email auth BFF", () => {
  it("links an email only after verifying the current anonymous user", async () => {
    const current = handler("link");
    const { POST, auth, reserveOtpRateLimit } = current;
    const response = await POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL })),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      reserveOtpRateLimit.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    expect(reserveOtpRateLimit).toHaveBeenCalledWith(EMAIL);
    expect(auth.updateUser).toHaveBeenCalledWith({ email: EMAIL });
    expectPrivate(response);
  });

  it("does not allow a registered session to enter the anonymous linking flow", async () => {
    const client = authClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: user(UID, false) },
      error: null,
    });
    const { POST, auth, reserveOtpRateLimit } = handler("link", client);
    const response = await POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL })),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(reserveOtpRateLimit).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("maps an existing email to ACCOUNT_LINK_CONFLICT without switching users", async () => {
    const client = authClient();
    client.auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    });
    const { POST, auth, releaseOtpReservation } = handler("link", client);
    const response = await POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL })),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ACCOUNT_LINK_CONFLICT");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(releaseOtpReservation).toHaveBeenCalledOnce();
  });

  it("requests recovery without creating a user and keeps Auth errors indistinguishable", async () => {
    const client = authClient();
    client.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "user_not_found", status: 400 },
    });
    const { POST, auth, releaseOtpReservation } = handler("recover", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/recover",
        JSON.stringify({ email: EMAIL, captchaToken: "captcha" }),
      ),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: EMAIL,
      options: { shouldCreateUser: false, captchaToken: "captcha" },
    });
    expect(releaseOtpReservation).not.toHaveBeenCalled();
  });

  it("reserves the shared OTP quota after link Auth and before email operations", async () => {
    const current = handler("recover");
    const response = await current.POST(
      request(
        "/api/v1/auth/email/recover",
        JSON.stringify({ email: EMAIL, captchaToken: "captcha" }),
      ),
    );
    expect(response.status).toBe(202);
    expect(current.reserveOtpRateLimit).toHaveBeenCalledWith(EMAIL);
    expect(
      current.reserveOtpRateLimit.mock.invocationCallOrder[0],
    ).toBeLessThan(current.auth.signInWithOtp.mock.invocationCallOrder[0]);

    const limited = handler("link");
    limited.reserveOtpRateLimit.mockRejectedValue(
      new ApiRouteError("RATE_LIMITED", "待ってください。", {
        retryAfterSeconds: 60,
      }),
    );
    const rejected = await limited.POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL })),
    );
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    expect((await rejected.json()).error.retryAfterSeconds).toBe(60);
    expect(limited.createClient).toHaveBeenCalledOnce();
    expect(limited.auth.getUser).toHaveBeenCalledOnce();
    expect(limited.auth.updateUser).not.toHaveBeenCalled();
  });

  it("releases only its reservation when Supabase rejects CAPTCHA", async () => {
    const client = authClient();
    client.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "captcha_failed", status: 400 },
    });
    const productionConfig: EmailEndpointConfig = {
      ...config,
      environment: "production",
      captcha: { configured: true, required: true },
    };
    const current = handler("recover", client, productionConfig);
    const response = await current.POST(
      request(
        "/api/v1/auth/email/recover",
        JSON.stringify({ email: EMAIL, captchaToken: "invalid" }),
      ),
    );

    expect(response.status).toBe(422);
    expect(
      (await response.json()).error.fieldErrors.captchaToken,
    ).toBeDefined();
    expect(current.releaseOtpReservation).toHaveBeenCalledOnce();
  });

  it("returns a complete wait contract for provider link throttling", async () => {
    const client = authClient();
    client.auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    const current = handler("link", client);
    const response = await current.POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()).error.retryAfterSeconds).toBe(60);
    expect(current.releaseOtpReservation).toHaveBeenCalledOnce();
  });

  it("fails closed when public recovery CAPTCHA is missing or has no token", async () => {
    const missingConfiguration: EmailEndpointConfig = {
      ...config,
      environment: "production",
      captcha: { configured: false, required: true },
    };
    const first = handler("recover", authClient(), missingConfiguration);
    const unavailable = await first.POST(
      request(
        "/api/v1/auth/email/recover",
        JSON.stringify({ email: EMAIL, captchaToken: "captcha" }),
      ),
    );

    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe(
      "TEMPORARILY_UNAVAILABLE",
    );
    expect(first.createClient).not.toHaveBeenCalled();

    const configured: EmailEndpointConfig = {
      ...missingConfiguration,
      captcha: { configured: true, required: true },
    };
    const second = handler("recover", authClient(), configured);
    const invalid = await second.POST(
      request("/api/v1/auth/email/recover", JSON.stringify({ email: EMAIL })),
    );

    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.fieldErrors.captchaToken).toBeDefined();
    expect(second.createClient).not.toHaveBeenCalled();
  });

  it("verifies link OTP as email_change and confirms the UID did not change", async () => {
    const client = authClient();
    client.auth.getUser
      .mockResolvedValueOnce({
        data: { user: user(UID, true) },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: user(UID, false) },
        error: null,
      });
    const { POST, auth, enforceOtpLinkVerificationRateLimit } = handler(
      "verify",
      client,
    );
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "link", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      isAnonymous: false,
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: EMAIL,
      token: "123456",
      type: "email_change",
    });
    expect(enforceOtpLinkVerificationRateLimit).toHaveBeenCalledWith(UID);
    expect(
      enforceOtpLinkVerificationRateLimit.mock.invocationCallOrder[0],
    ).toBeLessThan(auth.verifyOtp.mock.invocationCallOrder[0]);
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("checks the current anonymous user before spending a link verification attempt", async () => {
    const client = authClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: user(UID, false) },
      error: null,
    });
    const current = handler("verify", client);
    const response = await current.POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "link", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(403);
    expect(current.enforceOtpLinkVerificationRateLimit).not.toHaveBeenCalled();
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("preserves fresh-user provider throttling before link verification", async () => {
    const client = authClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "over_request_rate_limit", status: 429 },
    });
    const current = handler("verify", client);
    const response = await current.POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "link", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()).error.retryAfterSeconds).toBe(60);
    expect(current.enforceOtpLinkVerificationRateLimit).not.toHaveBeenCalled();
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("returns the complete local wait contract before OTP provider verification", async () => {
    const current = handler("verify");
    current.enforceOtpRecoveryVerificationRateLimit.mockRejectedValue(
      new ApiRouteError("RATE_LIMITED", "待ってください。", {
        retryAfterSeconds: 321,
      }),
    );
    const response = await current.POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect((await response.json()).error.retryAfterSeconds).toBe(321);
    expect(current.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("clears a mismatched link session and never reports authentication success", async () => {
    const client = authClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: user(OTHER_UID, false), session: null },
      error: null,
    });
    const { POST, auth } = handler("verify", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "link", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_OTP");
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("marks the Auth context unsafe when mismatched-session cleanup fails", async () => {
    const client = authClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: user(OTHER_UID, false), session: null },
      error: null,
    });
    client.auth.signOut.mockResolvedValue({ error: { code: "network" } });
    const { POST } = handler("verify", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "link", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("TEMPORARILY_UNAVAILABLE");
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");
  });

  it("fails private when post-OTP user verification throws", async () => {
    const client = authClient();
    client.auth.getUser.mockRejectedValue(new Error("network"));
    const { POST, auth } = handler("verify", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails private when OTP verification throws unexpectedly", async () => {
    const client = authClient();
    client.auth.verifyOtp.mockRejectedValue(new Error("cookie write failed"));
    const { POST } = handler("verify", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");
  });

  it("verifies recovery OTP with type email and confirms the resulting user", async () => {
    const client = authClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: user(UID, false) },
      error: null,
    });
    const current = handler("verify", client);
    const verifyRequest = request(
      "/api/v1/auth/email/verify",
      JSON.stringify({ flow: "recover", email: EMAIL, token: "654321" }),
    );
    const response = await current.POST(verifyRequest);

    expect(response.status).toBe(200);
    expect(
      current.enforceOtpRecoveryVerificationRateLimit,
    ).toHaveBeenCalledWith(EMAIL, verifyRequest);
    expect(
      current.enforceOtpRecoveryVerificationRateLimit.mock
        .invocationCallOrder[0],
    ).toBeLessThan(client.auth.verifyOtp.mock.invocationCallOrder[0]);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: EMAIL,
      token: "654321",
      type: "email",
    });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
  });

  it("returns INVALID_OTP without exposing the upstream Auth error", async () => {
    const client = authClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "otp_expired", status: 403, message: "sensitive" },
    });
    const { POST } = handler("verify", client);
    const response = await POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain("INVALID_OTP");
    expect(text).not.toContain("sensitive");
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBeNull();
  });

  it("preserves provider OTP verification throttling as a wait contract", async () => {
    const client = authClient();
    client.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_request_rate_limit", status: 429 },
    });
    const current = handler("verify", client);
    const response = await current.POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()).error.retryAfterSeconds).toBe(60);
  });

  it("preserves post-OTP fresh-user throttling and clears the unverified session", async () => {
    const client = authClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "over_request_rate_limit", status: 429 },
    });
    const current = handler("verify", client);
    const response = await current.POST(
      request(
        "/api/v1/auth/email/verify",
        JSON.stringify({ flow: "recover", email: EMAIL, token: "123456" }),
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");
    expect((await response.json()).error.retryAfterSeconds).toBe(60);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("signs out only the current session", async () => {
    const { POST, auth } = handler("signout");
    const response = await POST(request("/api/v1/auth/signout", "{}"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expectPrivate(response);
  });

  it("marks signout errors as a possible Auth context change", async () => {
    const client = authClient();
    client.auth.signOut.mockResolvedValue({
      error: { code: "session_missing" },
    });
    const { POST } = handler("signout", client);
    const response = await POST(request("/api/v1/auth/signout", "{}"));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-emanowa-auth-context-changed")).toBe("1");

    const thrown = authClient();
    thrown.auth.signOut.mockRejectedValue(new Error("network"));
    const second = handler("signout", thrown);
    const thrownResponse = await second.POST(
      request("/api/v1/auth/signout", "{}"),
    );
    expect(thrownResponse.status).toBe(503);
    expect(thrownResponse.headers.get("x-emanowa-auth-context-changed")).toBe(
      "1",
    );
  });

  it("rejects cross-origin, unknown fields, non-JSON, and oversized bodies before Auth", async () => {
    const first = handler("link");
    const crossOrigin = await first.POST(
      request("/api/v1/auth/email/link", JSON.stringify({ email: EMAIL }), {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    expect(first.createClient).not.toHaveBeenCalled();

    const second = handler("link");
    const unknown = await second.POST(
      request(
        "/api/v1/auth/email/link",
        JSON.stringify({ email: EMAIL, ownerId: UID }),
      ),
    );
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).error.fieldErrors.ownerId).toBeDefined();
    expect(second.createClient).not.toHaveBeenCalled();

    const third = handler("link");
    const nonJson = await third.POST(
      request("/api/v1/auth/email/link", "email=x", {
        "content-type": "text/plain",
      }),
    );
    expect(nonJson.status).toBe(422);
    expect(third.createClient).not.toHaveBeenCalled();

    const fourth = handler("link");
    const oversized = await fourth.POST(
      request(
        "/api/v1/auth/email/link",
        JSON.stringify({ email: `${"a".repeat(8_192)}@example.test` }),
      ),
    );
    expect(oversized.status).toBe(422);
    expect(fourth.createClient).not.toHaveBeenCalled();
  });

  it("fails closed when public Auth configuration is unavailable", async () => {
    const unavailable: EmailEndpointConfig = {
      ...config,
      supabase: { configured: false },
    };
    const { POST, createClient } = handler(
      "recover",
      authClient(),
      unavailable,
    );
    const response = await POST(
      request("/api/v1/auth/email/recover", JSON.stringify({ email: EMAIL })),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("TEMPORARILY_UNAVAILABLE");
    expect(createClient).not.toHaveBeenCalled();
  });
});
