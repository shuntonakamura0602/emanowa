import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { ApiRouteError } from "@/server/api/errors";
import { getServerRuntimeConfig } from "@/server/config";
import type {
  EnvironmentName,
  ServerRuntimeConfig,
} from "@/server/config/parse";
import {
  RATE_LIMIT_POLICIES,
  type RateLimitAction,
} from "@/server/rate-limit/policies";
import {
  consumeSharedRecoveryOtpVerificationRateLimit,
  consumeSharedRateLimit,
  releaseSharedOtpRateLimit,
  reserveSharedOtpRateLimit,
  type SharedRateLimitResult,
} from "@/server/rate-limit/repository";

type RateLimitConfig = Pick<
  ServerRuntimeConfig,
  "environment" | "rateLimitHmacSecret" | "trustedProxyHops"
>;

export type RateLimitDependencies = {
  getConfig(): RateLimitConfig;
  consume(
    action: RateLimitAction,
    subjectHash: Buffer,
    windowSeconds: number,
    limit: number,
  ): Promise<SharedRateLimitResult>;
  consumeRecoveryOtpVerification(
    pairSubjectHash: Buffer,
    targetSubjectHash: Buffer,
    sourceSubjectHash: Buffer,
  ): Promise<SharedRateLimitResult>;
  reserveOtp(
    subjectHash: Buffer,
    windowSeconds: number,
    limit: number,
    reservationId: string,
  ): Promise<SharedRateLimitResult>;
  releaseOtp(subjectHash: Buffer, reservationId: string): Promise<boolean>;
  createReservationId?(): string;
};

export type OtpRateLimitReservation = {
  release(): Promise<void>;
};

function unavailable(message = "回数制限を確認できませんでした。"): never {
  throw new ApiRouteError("TEMPORARILY_UNAVAILABLE", message);
}

function subjectHash(
  action: RateLimitAction,
  subject: string,
  secret: string | null,
): Buffer {
  if (!secret) return unavailable("回数制限の設定が完了していません。");
  return createHmac("sha256", secret)
    .update("emanowa-rate-limit-v1\0", "utf8")
    .update(action, "utf8")
    .update("\0", "utf8")
    .update(subject, "utf8")
    .digest();
}

function normalizeEmailForQuota(email: string): string {
  return email.trim().normalize("NFC").toLocaleLowerCase("en-US");
}

function normalizedForwardedAddress(value: string): string | null {
  const trimmed = value.trim();
  const candidate =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version === 6) {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    const canonical = hostname.slice(1, -1).toLowerCase();
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(canonical);
    if (mapped) {
      const upper = Number.parseInt(mapped[1], 16);
      const lower = Number.parseInt(mapped[2], 16);
      return `${upper >>> 8}.${upper & 0xff}.${lower >>> 8}.${lower & 0xff}`;
    }
    return canonical;
  }
  return null;
}

export function resolveRequestSource(
  request: Request,
  environment: EnvironmentName,
  trustedProxyHops: number | null,
): string {
  if (trustedProxyHops === null) {
    if (environment === "test") {
      const testAddress = normalizedForwardedAddress(
        request.headers.get("x-emanowa-test-client-ip") ?? "127.0.0.1",
      );
      if (testAddress) return testAddress;
    }
    if (environment === "development") return "development-loopback";
    return unavailable("信頼するプロキシの設定が完了していません。");
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return unavailable("送信元を安全に確認できませんでした。");
  const chain = forwarded.split(",").map((part) => part.trim());
  const index = chain.length - trustedProxyHops;
  if (index < 0) return unavailable("送信元を安全に確認できませんでした。");
  const address = normalizedForwardedAddress(chain[index] ?? "");
  if (!address) return unavailable("送信元を安全に確認できませんでした。");
  return address;
}

export function createRateLimitEnforcer(dependencies: RateLimitDependencies) {
  async function enforce(
    action: RateLimitAction,
    subject: string,
    config = dependencies.getConfig(),
  ): Promise<void> {
    if (!subject) return unavailable();
    const policy = RATE_LIMIT_POLICIES[action];
    const result = await dependencies.consume(
      action,
      subjectHash(action, subject, config.rateLimitHmacSecret),
      policy.windowSeconds,
      policy.limit,
    );
    if (!result.allowed) {
      throw new ApiRouteError(
        "RATE_LIMITED",
        "少し時間をおいて、もう一度お試しください。",
        { retryAfterSeconds: Math.max(1, result.retryAfterSeconds) },
      );
    }
  }

  return {
    enforceActorRateLimit(
      action: "create" | "edit" | "report",
      actorId: string,
    ) {
      return enforce(action, `actor:${actorId}`);
    },
    enforceOtpLinkVerificationRateLimit(actorId: string) {
      return enforce("otp_verify_link", `link:actor:${actorId}`);
    },
    async enforceOtpRecoveryVerificationRateLimit(
      email: string,
      request: Request,
    ) {
      const config = dependencies.getConfig();
      const source = resolveRequestSource(
        request,
        config.environment,
        config.trustedProxyHops,
      );
      const normalizedEmail = normalizeEmailForQuota(email);
      const result = await dependencies.consumeRecoveryOtpVerification(
        subjectHash(
          "otp_verify",
          `recover:email:${normalizedEmail}:source:${source}`,
          config.rateLimitHmacSecret,
        ),
        subjectHash(
          "otp_verify_target",
          `recover:email:${normalizedEmail}`,
          config.rateLimitHmacSecret,
        ),
        subjectHash(
          "otp_verify_source",
          `recover:source:${source}`,
          config.rateLimitHmacSecret,
        ),
      );
      if (!result.allowed) {
        throw new ApiRouteError(
          "RATE_LIMITED",
          "少し時間をおいて、もう一度お試しください。",
          { retryAfterSeconds: Math.max(1, result.retryAfterSeconds) },
        );
      }
    },
    async reserveOtpRateLimit(email: string): Promise<OtpRateLimitReservation> {
      const config = dependencies.getConfig();
      const policy = RATE_LIMIT_POLICIES.otp;
      const hash = subjectHash(
        "otp",
        `email:${normalizeEmailForQuota(email)}`,
        config.rateLimitHmacSecret,
      );
      const reservationId =
        dependencies.createReservationId?.() ?? randomUUID();
      const result = await dependencies.reserveOtp(
        hash,
        policy.windowSeconds,
        policy.limit,
        reservationId,
      );
      if (!result.allowed) {
        throw new ApiRouteError(
          "RATE_LIMITED",
          "少し時間をおいて、もう一度お試しください。",
          { retryAfterSeconds: Math.max(1, result.retryAfterSeconds) },
        );
      }

      let released = false;
      return {
        async release() {
          if (released) return;
          if (!(await dependencies.releaseOtp(hash, reservationId))) {
            return unavailable("回数制限の予約を安全に取り消せませんでした。");
          }
          released = true;
        },
      };
    },
    enforceImageRateLimit(request: Request) {
      const config = dependencies.getConfig();
      const source = resolveRequestSource(
        request,
        config.environment,
        config.trustedProxyHops,
      );
      return enforce("image", `source:${source}`);
    },
  };
}

const productionEnforcer = createRateLimitEnforcer({
  getConfig: getServerRuntimeConfig,
  consume: consumeSharedRateLimit,
  consumeRecoveryOtpVerification: consumeSharedRecoveryOtpVerificationRateLimit,
  reserveOtp: reserveSharedOtpRateLimit,
  releaseOtp: releaseSharedOtpRateLimit,
});

export const enforceActorRateLimit = productionEnforcer.enforceActorRateLimit;
export const enforceOtpLinkVerificationRateLimit =
  productionEnforcer.enforceOtpLinkVerificationRateLimit;
export const enforceOtpRecoveryVerificationRateLimit =
  productionEnforcer.enforceOtpRecoveryVerificationRateLimit;
export const reserveOtpRateLimit = productionEnforcer.reserveOtpRateLimit;
export const enforceImageRateLimit = productionEnforcer.enforceImageRateLimit;
