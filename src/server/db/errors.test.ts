import { describe, expect, it } from "vitest";

import { mapDatabaseError } from "@/server/db/errors";

describe("mapDatabaseError", () => {
  it.each([
    ["P1001", "AUTH_REQUIRED", 401],
    ["P1002", "VALIDATION_ERROR", 422],
    ["P1003", "WORLD_NOT_OPEN", 409],
    ["P1004", "POSTING_PAUSED", 409],
    ["P1005", "IDEMPOTENCY_KEY_REUSED", 409],
    ["P1006", "OWNER_LIMIT_REACHED", 409],
    ["P1007", "SLOT_TAKEN", 409],
    ["P1008", "NOT_FOUND", 404],
    ["P1009", "VERSION_CONFLICT", 409],
    ["P1010", "FORBIDDEN", 403],
  ])("maps allow-listed SQLSTATE %s", (sqlState, code, status) => {
    expect(mapDatabaseError({ code: sqlState })).toMatchObject({
      code,
      httpStatus: status,
    });
  });

  it("maps known unique constraints without exposing database detail", () => {
    const error = mapDatabaseError({
      code: "23505",
      constraint: "emas_live_slot_uq",
      detail: "secret wish text",
      message: "raw sql",
    });

    expect(error.code).toBe("SLOT_TAKEN");
    expect(JSON.stringify(error)).not.toContain("secret wish text");
    expect(error.message).not.toContain("raw sql");
  });

  it("maps unknown failures to a generic unavailable response", () => {
    const error = mapDatabaseError(new Error("DATABASE_URL=secret wish"));

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(error.message).not.toContain("secret wish");
  });
});
