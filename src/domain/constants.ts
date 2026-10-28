export const WORLD_WIDTH = 1_000 as const;
export const WORLD_HEIGHT = 1_000 as const;
export const WORLD_SLOT_COUNT = WORLD_WIDTH * WORLD_HEIGHT;
export const CHUNK_SIZE = 20 as const;
export const CHUNK_AXIS_COUNT = WORLD_WIDTH / CHUNK_SIZE;
export const CHUNK_CELL_LIMIT = CHUNK_SIZE * CHUNK_SIZE;

export const CATEGORY_VALUES = [
  "family",
  "health",
  "study",
  "work",
  "love",
  "challenge",
  "other",
] as const;

export const VISIBILITY_VALUES = ["public", "unlisted"] as const;
export const MESSAGE_VISIBILITY_VALUES = ["public", "owner_only"] as const;
export const EMA_STATUS_VALUES = ["active", "hidden", "deleted"] as const;
export const OWNER_EMA_STATUS_VALUES = ["active", "hidden"] as const;
export const WORLD_STATE_VALUES = ["preview", "open", "archived"] as const;
export const DESIGN_VALUES = ["basic_wood"] as const;

export const REPORT_REASON_VALUES = [
  "spam",
  "harassment",
  "personal_information",
  "sexual_content",
  "illegal_content",
  "other",
] as const;

export const API_ERROR_CODE_VALUES = [
  "INVALID_QUERY",
  "INVALID_CURSOR",
  "INVALID_OTP",
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "ADMIN_REQUIRED",
  "NOT_FOUND",
  "SLOT_TAKEN",
  "OWNER_LIMIT_REACHED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "WORLD_NOT_OPEN",
  "POSTING_PAUSED",
  "ACCOUNT_LINK_CONFLICT",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "TEMPORARILY_UNAVAILABLE",
] as const;

export const API_ERROR_HTTP_STATUS = {
  INVALID_QUERY: 400,
  INVALID_CURSOR: 400,
  INVALID_OTP: 400,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  ADMIN_REQUIRED: 403,
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  OWNER_LIMIT_REACHED: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  WORLD_NOT_OPEN: 409,
  POSTING_PAUSED: 409,
  ACCOUNT_LINK_CONFLICT: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  TEMPORARILY_UNAVAILABLE: 503,
} as const satisfies Record<(typeof API_ERROR_CODE_VALUES)[number], number>;

export const INPUT_LIMITS = {
  requestJsonBytes: 8 * 1_024,
  wishGraphemes: 80,
  wishUtf8Bytes: 4 * 1_024,
  wishLines: 4,
  nicknameGraphemes: 20,
  nicknameUtf8Bytes: 1 * 1_024,
  reportDetailGraphemes: 200,
  reportDetailUtf8Bytes: 2 * 1_024,
} as const;
