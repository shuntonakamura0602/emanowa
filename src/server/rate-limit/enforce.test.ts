import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRateLimitEnforcer,
  resolveRequestSource,
} from "@/server/rate-limit/enforce";

const SECRET = "test-only-rate-limit-secret-with-at-least-32-bytes";

function dependencies(allowed: boolean, retryAfterSeconds = 0) {
  const consume = vi.fn().mockResolvedValue({
    allowed,
    currentCount: allowed ? 1 : 6,
    retryAfterSeconds,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1_000).toISOString(),
  });
  const consumeRecoveryOtpVerification = vi.fn().mockResolvedValue({
    allowed,
    currentCount: allowed ? 1 : 6,
    retryAfterSeconds,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1_000).toISOString(),
  });
  const reserveOtp = vi.fn().mockResolvedValue({
    allowed,
    currentCount: allowed ? 1 : 2,
    retryAfterSeconds,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1_000).toISOString(),
  });
  const releaseOtp = vi.fn().mockResolvedValue(true);
  return {
    consume,
    consumeRecoveryOtpVerification,
    releaseOtp,
    reserveOtp,
    enforcer: createRateLimitEnforcer({
      getConfig: () => ({
        environment: "test",
        rateLimitHmacSecret: SECRET,
        trustedProxyHops: null,
      }),
      consume,
      consumeRecoveryOtpVerification,
      reserveOtp,
      releaseOtp,
      createReservationId: () => "11111111-1111-4111-8111-111111111111",
    }),
  };
}

describe("shared rate-limit enforcement", () => {
  it("uses the fixed server policy and stores only a 32-byte HMAC subject", async () => {
    const { consume, enforcer } = dependencies(true);
    await enforcer.enforceActorRateLimit(
      "report",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(consume).toHaveBeenCalledOnce();
    const [action, hash, windowSeconds, limit] = consume.mock.calls[0] ?? [];
    expect(action).toBe("report");
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(hash).toHaveLength(32);
    expect(hash.toString("hex")).not.toContain("11111111");
    expect(windowSeconds).toBe(3_600);
    expect(limit).toBe(5);
  });

  it("returns a retryable 429 without calling the protected operation", async () => {
    const { enforcer } = dependencies(false, 42);
    await expect(
      enforcer.enforceActorRateLimit(
        "report",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 42,
    });
  });

  it("normalizes OTP quota addresses without storing the address", async () => {
    const { reserveOtp, enforcer } = dependencies(true);
    await enforcer.reserveOtpRateLimit(" Owner@Example.TEST ");
    const firstHash = reserveOtp.mock.calls[0]?.[0] as Buffer;

    reserveOtp.mockClear();
    await enforcer.reserveOtpRateLimit("owner@example.test");
    const secondHash = reserveOtp.mock.calls[0]?.[0] as Buffer;
    expect(firstHash.equals(secondHash)).toBe(true);
  });

  it("keeps OTP verification attempts independent from send reservations", async () => {
    const { consume, enforcer } = dependencies(true);
    await enforcer.enforceOtpLinkVerificationRateLimit(
      "11111111-1111-4111-8111-111111111111",
    );

    const [action, hash, windowSeconds, limit] = consume.mock.calls[0] ?? [];
    expect(action).toBe("otp_verify_link");
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(hash).toHaveLength(32);
    expect(hash.toString("hex")).not.toContain("11111111");
    expect(windowSeconds).toBe(600);
    expect(limit).toBe(5);
  });

  it("scopes recovery verification attempts to normalized email and trusted source", async () => {
    const { consumeRecoveryOtpVerification, enforcer } = dependencies(true);
    const firstRequest = new Request("https://emanowa.test/verify", {
      headers: { "x-emanowa-test-client-ip": "203.0.113.20" },
    });
    await enforcer.enforceOtpRecoveryVerificationRateLimit(
      " Owner@Example.TEST ",
      firstRequest,
    );
    expect(consumeRecoveryOtpVerification).toHaveBeenCalledOnce();
    const [firstPairHash, firstTargetHash, firstSourceHash] =
      consumeRecoveryOtpVerification.mock.calls[0] as [Buffer, Buffer, Buffer];
    for (const hash of [firstPairHash, firstTargetHash, firstSourceHash]) {
      expect(Buffer.isBuffer(hash)).toBe(true);
      expect(hash).toHaveLength(32);
      expect(hash.toString("hex")).not.toContain("owner");
    }

    consumeRecoveryOtpVerification.mockClear();
    await enforcer.enforceOtpRecoveryVerificationRateLimit(
      "owner@example.test",
      new Request("https://emanowa.test/verify", {
        headers: { "x-emanowa-test-client-ip": "203.0.113.20" },
      }),
    );
    const [samePairHash, sameTargetHash, sameSourceHash] =
      consumeRecoveryOtpVerification.mock.calls[0] as [Buffer, Buffer, Buffer];
    expect(firstSourceHash.equals(sameSourceHash)).toBe(true);
    expect(firstTargetHash.equals(sameTargetHash)).toBe(true);
    expect(firstPairHash.equals(samePairHash)).toBe(true);

    consumeRecoveryOtpVerification.mockClear();
    await enforcer.enforceOtpRecoveryVerificationRateLimit(
      "other@example.test",
      new Request("https://emanowa.test/verify", {
        headers: { "x-emanowa-test-client-ip": "203.0.113.20" },
      }),
    );
    const [otherTargetPairHash, otherTargetHash, otherTargetSameSourceHash] =
      consumeRecoveryOtpVerification.mock.calls[0] as [Buffer, Buffer, Buffer];
    expect(firstSourceHash.equals(otherTargetSameSourceHash)).toBe(true);
    expect(firstTargetHash.equals(otherTargetHash)).toBe(false);
    expect(firstPairHash.equals(otherTargetPairHash)).toBe(false);

    consumeRecoveryOtpVerification.mockClear();
    await enforcer.enforceOtpRecoveryVerificationRateLimit(
      "owner@example.test",
      new Request("https://emanowa.test/verify", {
        headers: { "x-emanowa-test-client-ip": "203.0.113.21" },
      }),
    );
    const [otherPairHash, otherSourceTargetHash, otherSourceHash] =
      consumeRecoveryOtpVerification.mock.calls[0] as [Buffer, Buffer, Buffer];
    expect(firstSourceHash.equals(otherSourceHash)).toBe(false);
    expect(firstTargetHash.equals(otherSourceTargetHash)).toBe(true);
    expect(firstPairHash.equals(otherPairHash)).toBe(false);
  });

  it("returns the atomic recovery limiter retry without consuming generic counters", async () => {
    const { consume, consumeRecoveryOtpVerification, enforcer } = dependencies(
      false,
      180,
    );
    await expect(
      enforcer.enforceOtpRecoveryVerificationRateLimit(
        "target@example.test",
        new Request("https://emanowa.test/verify", {
          headers: { "x-emanowa-test-client-ip": "203.0.113.22" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 180,
    });
    expect(consumeRecoveryOtpVerification).toHaveBeenCalledOnce();
    expect(consume).not.toHaveBeenCalled();
  });

  it("releases exactly one OTP reservation and makes release idempotent", async () => {
    const { reserveOtp, releaseOtp, enforcer } = dependencies(true);
    const reservation = await enforcer.reserveOtpRateLimit(
      "　Owner@Example.TEST ",
    );

    const [hash, windowSeconds, limit, reservationId] =
      reserveOtp.mock.calls[0] ?? [];
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(windowSeconds).toBe(60);
    expect(limit).toBe(1);
    expect(reservationId).toBe("11111111-1111-4111-8111-111111111111");

    await reservation.release();
    await reservation.release();
    expect(releaseOtp).toHaveBeenCalledOnce();
    expect(releaseOtp).toHaveBeenCalledWith(hash, reservationId);
  });

  it("selects the client address from the trusted right side of the proxy chain", () => {
    const request = new Request("https://emanowa.test/image", {
      headers: {
        "x-forwarded-for": "198.51.100.7, 10.0.0.8, 10.0.0.9",
      },
    });
    expect(resolveRequestSource(request, "production", 2)).toBe("10.0.0.8");
    expect(() =>
      resolveRequestSource(
        new Request("https://emanowa.test/image"),
        "production",
        1,
      ),
    ).toThrow();
  });

  it("accepts the isolated test source header only in test", () => {
    const request = new Request("https://emanowa.test/image", {
      headers: { "x-emanowa-test-client-ip": "203.0.113.44" },
    });
    expect(resolveRequestSource(request, "test", null)).toBe("203.0.113.44");
    expect(() => resolveRequestSource(request, "production", null)).toThrow();
  });

  it("canonicalizes equivalent IPv6 source spellings to one subject", () => {
    const expanded = new Request("https://emanowa.test/image", {
      headers: {
        "x-emanowa-test-client-ip": "2001:0db8:0000:0000:0000:0000:0000:0001",
      },
    });
    const compressed = new Request("https://emanowa.test/image", {
      headers: { "x-emanowa-test-client-ip": "2001:db8::1" },
    });
    expect(resolveRequestSource(expanded, "test", null)).toBe("2001:db8::1");
    expect(resolveRequestSource(compressed, "test", null)).toBe("2001:db8::1");
  });

  it("canonicalizes IPv4-mapped IPv6 spellings to the same IPv4 subject", () => {
    const sources = ["203.0.113.20", "::ffff:203.0.113.20", "::ffff:cb00:7114"];
    expect(
      sources.map((source) =>
        resolveRequestSource(
          new Request("https://emanowa.test/image", {
            headers: { "x-emanowa-test-client-ip": source },
          }),
          "test",
          null,
        ),
      ),
    ).toEqual(["203.0.113.20", "203.0.113.20", "203.0.113.20"]);
  });

  it("fails closed when the HMAC secret is unavailable", async () => {
    const enforcer = createRateLimitEnforcer({
      getConfig: () => ({
        environment: "production",
        rateLimitHmacSecret: null,
        trustedProxyHops: 1,
      }),
      consume: vi.fn(),
      consumeRecoveryOtpVerification: vi.fn(),
      reserveOtp: vi.fn(),
      releaseOtp: vi.fn(),
    });
    await expect(
      enforcer.enforceActorRateLimit(
        "create",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE", status: 503 });
  });
});
