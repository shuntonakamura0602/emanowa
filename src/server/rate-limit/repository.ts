import "server-only";

import type { QueryResultRow } from "pg";

import { withDatabaseTransaction } from "@/server/db/transaction";
import type { DatabaseClient } from "@/server/db/types";
import type { RateLimitAction } from "@/server/rate-limit/policies";

type RateLimitRow = QueryResultRow & {
  allowed: boolean;
  current_count: number | string;
  retry_after_seconds: number | string;
  reset_at: Date | string;
};

type ReleaseOtpReservationRow = QueryResultRow & {
  released: boolean;
};

export type SharedRateLimitResult = {
  allowed: boolean;
  currentCount: number;
  retryAfterSeconds: number;
  resetAt: string;
};

function parseInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid ${field} from consume_rate_limit`);
  }
  return parsed;
}

function parseTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid reset_at from consume_rate_limit");
  }
  return parsed.toISOString();
}

export async function queryConsumeRateLimit(
  client: DatabaseClient,
  action: RateLimitAction,
  subjectHash: Buffer,
  windowSeconds: number,
  limit: number,
): Promise<SharedRateLimitResult> {
  const result = await client.query<RateLimitRow>(
    `select * from app_private.consume_rate_limit(
       $1::text, $2::bytea, $3::integer, $4::integer
     )`,
    [action, subjectHash, windowSeconds, limit],
  );
  const row = result.rows[0];
  if (!row) throw new Error("consume_rate_limit returned no result");
  return {
    allowed: row.allowed,
    currentCount: parseInteger(row.current_count, "current_count"),
    retryAfterSeconds: parseInteger(
      row.retry_after_seconds,
      "retry_after_seconds",
    ),
    resetAt: parseTimestamp(row.reset_at),
  };
}

export function consumeSharedRateLimit(
  action: RateLimitAction,
  subjectHash: Buffer,
  windowSeconds: number,
  limit: number,
): Promise<SharedRateLimitResult> {
  return withDatabaseTransaction({ actorId: null }, (client) =>
    queryConsumeRateLimit(client, action, subjectHash, windowSeconds, limit),
  );
}

export async function queryConsumeRecoveryOtpVerificationRateLimit(
  client: DatabaseClient,
  pairSubjectHash: Buffer,
  targetSubjectHash: Buffer,
  sourceSubjectHash: Buffer,
): Promise<SharedRateLimitResult> {
  const result = await client.query<RateLimitRow>(
    `select * from app_private.consume_recovery_otp_verification_rate_limit(
       $1::bytea, $2::bytea, $3::bytea
     )`,
    [pairSubjectHash, targetSubjectHash, sourceSubjectHash],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      "consume_recovery_otp_verification_rate_limit returned no result",
    );
  }
  return {
    allowed: row.allowed,
    currentCount: parseInteger(row.current_count, "current_count"),
    retryAfterSeconds: parseInteger(
      row.retry_after_seconds,
      "retry_after_seconds",
    ),
    resetAt: parseTimestamp(row.reset_at),
  };
}

export function consumeSharedRecoveryOtpVerificationRateLimit(
  pairSubjectHash: Buffer,
  targetSubjectHash: Buffer,
  sourceSubjectHash: Buffer,
): Promise<SharedRateLimitResult> {
  return withDatabaseTransaction({ actorId: null }, (client) =>
    queryConsumeRecoveryOtpVerificationRateLimit(
      client,
      pairSubjectHash,
      targetSubjectHash,
      sourceSubjectHash,
    ),
  );
}

export async function queryReserveOtpRateLimit(
  client: DatabaseClient,
  subjectHash: Buffer,
  windowSeconds: number,
  limit: number,
  reservationId: string,
): Promise<SharedRateLimitResult> {
  const result = await client.query<RateLimitRow>(
    `select * from app_private.reserve_otp_rate_limit(
       $1::bytea, $2::integer, $3::integer, $4::uuid
     )`,
    [subjectHash, windowSeconds, limit, reservationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("reserve_otp_rate_limit returned no result");
  return {
    allowed: row.allowed,
    currentCount: parseInteger(row.current_count, "current_count"),
    retryAfterSeconds: parseInteger(
      row.retry_after_seconds,
      "retry_after_seconds",
    ),
    resetAt: parseTimestamp(row.reset_at),
  };
}

export function reserveSharedOtpRateLimit(
  subjectHash: Buffer,
  windowSeconds: number,
  limit: number,
  reservationId: string,
): Promise<SharedRateLimitResult> {
  return withDatabaseTransaction({ actorId: null }, (client) =>
    queryReserveOtpRateLimit(
      client,
      subjectHash,
      windowSeconds,
      limit,
      reservationId,
    ),
  );
}

export async function queryReleaseOtpRateLimit(
  client: DatabaseClient,
  subjectHash: Buffer,
  reservationId: string,
): Promise<boolean> {
  const result = await client.query<ReleaseOtpReservationRow>(
    `select app_private.release_otp_rate_limit(
       $1::bytea, $2::uuid
     ) as released`,
    [subjectHash, reservationId],
  );
  const released = result.rows[0]?.released;
  if (typeof released !== "boolean") {
    throw new Error("release_otp_rate_limit returned an invalid result");
  }
  return released;
}

export function releaseSharedOtpRateLimit(
  subjectHash: Buffer,
  reservationId: string,
): Promise<boolean> {
  return withDatabaseTransaction({ actorId: null }, (client) =>
    queryReleaseOtpRateLimit(client, subjectHash, reservationId),
  );
}
