import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  queryCreateEma,
  queryDeleteEma,
  queryOwnerEma,
  queryOwnerWorlds,
  queryPublicEma,
  queryPublicWorld,
  queryUpdateEma,
} from "@/server/db/queries";
import type { DatabaseClient } from "@/server/db/types";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function recordingClient(rows: QueryResultRow[] = []) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    void text;
    void values;
    return result(rows);
  });
  return {
    client: { query, release: vi.fn() } as unknown as DatabaseClient,
    query,
  };
}

describe("private database function queries", () => {
  it("uses only the private read functions with positional parameters", async () => {
    const database = recordingClient();

    await queryPublicWorld(database.client, "2027");
    await queryPublicEma(database.client, "2027", PUBLIC_ID);
    await queryOwnerEma(database.client, "2027");
    await queryOwnerWorlds(database.client, 13, null);

    expect(database.query.mock.calls[0]).toEqual([
      expect.stringContaining("app_private.get_public_world($1::text)"),
      ["2027"],
    ]);
    expect(database.query.mock.calls[1]).toEqual([
      "select * from app_private.get_public_ema($1::text, $2::uuid)",
      ["2027", PUBLIC_ID],
    ]);
    expect(database.query.mock.calls[2]).toEqual([
      "select * from app_private.get_owner_ema($1::text)",
      ["2027"],
    ]);
    expect(database.query.mock.calls[3]).toEqual([
      expect.stringContaining("app_private.list_owner_worlds("),
      [13, null, null],
    ]);
  });

  it("passes the exact create function contract without an owner argument", async () => {
    const requestHash = Buffer.alloc(32, 7);
    const database = recordingClient([
      {
        public_id: PUBLIC_ID,
        world_slug: "2027",
        version: 1,
        result: "created",
        canonical_url: `/w/2027/e/${PUBLIC_ID}`,
        replayed: false,
      },
    ]);

    await queryCreateEma(
      database.client,
      "2027",
      {
        x: 10,
        y: 20,
        wishText: "願い",
        nickname: null,
        category: "other",
        designId: "basic_wood",
        visibility: "public",
        messageVisibility: "owner_only",
      },
      IDEMPOTENCY_KEY,
      requestHash,
    );

    const [sql, values] = database.query.mock.calls[0] ?? [];
    expect(sql).toContain("app_private.create_ema(");
    expect(sql).toContain("$11::bytea");
    expect(values).toEqual([
      "2027",
      10,
      20,
      "願い",
      null,
      "other",
      "basic_wood",
      "public",
      "owner_only",
      IDEMPOTENCY_KEY,
      requestHash,
    ]);
    expect(values).toHaveLength(11);
  });

  it("passes PATCH presence flags and DELETE version without an owner argument", async () => {
    const requestHash = Buffer.alloc(32, 9);
    const database = recordingClient([
      {
        public_id: PUBLIC_ID,
        world_slug: "2027",
        version: 2,
        result: "updated",
        canonical_url: `/w/2027/e/${PUBLIC_ID}`,
        replayed: false,
      },
    ]);

    await queryUpdateEma(
      database.client,
      PUBLIC_ID,
      { expectedVersion: 1, nickname: null, visibility: "unlisted" },
      IDEMPOTENCY_KEY,
      requestHash,
    );
    const [updateSql, updateValues] = database.query.mock.calls[0] ?? [];
    expect(updateSql).toContain("app_private.update_ema(");
    expect(updateValues).toEqual([
      PUBLIC_ID,
      1,
      false,
      null,
      true,
      null,
      false,
      null,
      false,
      null,
      true,
      "unlisted",
      false,
      null,
      IDEMPOTENCY_KEY,
      requestHash,
    ]);

    await queryDeleteEma(
      database.client,
      PUBLIC_ID,
      { expectedVersion: 2 },
      IDEMPOTENCY_KEY,
      requestHash,
    );
    expect(database.query.mock.calls[1]).toEqual([
      expect.stringContaining("app_private.delete_ema("),
      [PUBLIC_ID, 2, IDEMPOTENCY_KEY, requestHash],
    ]);
  });
});
