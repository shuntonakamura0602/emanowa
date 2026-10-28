import type { ApiErrorCode } from "@/domain";

export class DatabaseConfigurationError extends Error {
  constructor(message = "データベース設定を確認してください。") {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseOperationError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;

  constructor(code: ApiErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "DatabaseOperationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type PostgresErrorLike = {
  code?: unknown;
  constraint?: unknown;
};

const CONSTRAINT_ERRORS = {
  emas_live_slot_uq: [
    "SLOT_TAKEN",
    409,
    "この場所には、先に絵馬が掛けられました。",
  ],
  emas_live_owner_uq: [
    "OWNER_LIMIT_REACHED",
    409,
    "この年には、すでに絵馬を掛けています。",
  ],
  idempotency_owner_operation_key_uq: [
    "IDEMPOTENCY_KEY_REUSED",
    409,
    "同じ送信キーを別の内容には使用できません。",
  ],
} as const satisfies Record<string, readonly [ApiErrorCode, number, string]>;

const RETRYABLE_DATABASE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "40001",
  "40P01",
  "53300",
  "53400",
  "55P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

const CUSTOM_SQLSTATE_ERRORS = {
  P1001: ["AUTH_REQUIRED", 401, "認証が必要です。"],
  P1002: ["VALIDATION_ERROR", 422, "入力内容を確認してください。"],
  P1003: ["WORLD_NOT_OPEN", 409, "この年は現在、絵馬を受け付けていません。"],
  P1004: ["POSTING_PAUSED", 409, "ただいま新しい絵馬の受付を停止しています。"],
  P1005: [
    "IDEMPOTENCY_KEY_REUSED",
    409,
    "同じ送信キーを別の内容には使用できません。",
  ],
  P1006: ["OWNER_LIMIT_REACHED", 409, "この年には、すでに絵馬を掛けています。"],
  P1007: ["SLOT_TAKEN", 409, "この場所には、先に絵馬が掛けられました。"],
  P1008: ["NOT_FOUND", 404, "絵馬が見つかりません。"],
  P1009: [
    "VERSION_CONFLICT",
    409,
    "別の画面で更新されています。現在の内容を確認してください。",
  ],
  P1010: ["FORBIDDEN", 403, "この操作は許可されていません。"],
} as const satisfies Record<string, readonly [ApiErrorCode, number, string]>;

function errorTuple(
  error: PostgresErrorLike,
): readonly [ApiErrorCode, number, string] | null {
  const constraint =
    typeof error.constraint === "string" ? error.constraint : null;

  if (constraint && constraint in CONSTRAINT_ERRORS) {
    return CONSTRAINT_ERRORS[constraint as keyof typeof CONSTRAINT_ERRORS];
  }
  if (typeof error.code === "string" && error.code in CUSTOM_SQLSTATE_ERRORS) {
    return CUSTOM_SQLSTATE_ERRORS[
      error.code as keyof typeof CUSTOM_SQLSTATE_ERRORS
    ];
  }

  if (error.code === "23514" || error.code === "22023") {
    return ["VALIDATION_ERROR", 422, "入力内容を確認してください。"];
  }
  if (
    typeof error.code === "string" &&
    RETRYABLE_DATABASE_CODES.has(error.code)
  ) {
    return [
      "TEMPORARILY_UNAVAILABLE",
      503,
      "現在データベースへ接続できません。時間をおいて再試行してください。",
    ];
  }

  return null;
}

/**
 * Maps only allow-listed Postgres metadata. SQL, detail, message, input text,
 * connection strings, and stack traces never become API responses.
 */
export function mapDatabaseError(error: unknown): DatabaseOperationError {
  if (error instanceof DatabaseOperationError) {
    return error;
  }
  if (error instanceof DatabaseConfigurationError) {
    return new DatabaseOperationError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "データベースが設定されていません。",
    );
  }

  const tuple = errorTuple(
    error && typeof error === "object" ? (error as PostgresErrorLike) : {},
  );
  if (tuple) {
    return new DatabaseOperationError(...tuple);
  }

  return new DatabaseOperationError(
    "TEMPORARILY_UNAVAILABLE",
    503,
    "一時的に処理できません。時間をおいて再試行してください。",
  );
}
