import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  queryCreateEma,
  queryDeleteEma,
  queryOwnerEma,
  queryOwnerWorlds,
  queryPublicChunk,
  queryPublicEma,
  queryPublicEmaFeed,
  queryPublicOverview,
  queryPublicWorld,
  queryRandomPublicEma,
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
    await queryPublicOverview(database.client, "2027", 20);
    await queryPublicChunk(database.client, "2027", 0, 49);
    await queryPublicEmaFeed(database.client, "2027", 24, "health", null);
    await queryRandomPublicEma(database.client, "2027", "study", PUBLIC_ID);

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
    expect(database.query.mock.calls[4]).toEqual([
      expect.stringContaining("app_private.get_public_overview("),
      ["2027", 20],
    ]);
    expect(database.query.mock.calls[5]).toEqual([
      expect.stringMatching(
        /get_public_chunk_meta[\s\S]+left join lateral app_private\.get_public_chunk/u,
      ),
      ["2027", 0, 49],
    ]);
    expect(database.query.mock.calls[6]).toEqual([
      expect.stringContaining("app_private.list_public_emas("),
      ["2027", 24, "health", null, null],
    ]);
    expect(database.query.mock.calls[7]).toEqual([
      expect.stringContaining("app_private.get_random_public_ema("),
      ["2027", "study", PUBLIC_ID],
    ]);
  });

  it("reads chunk metadata and cells in one SQL statement and one snapshot", async () => {
    const database = recordingClient();
    await queryPublicChunk(database.client, "2027", 12, 34);
    expect(database.query).toHaveBeenCalledTimes(1);
    const [sql, values] = database.query.mock.calls[0] ?? [];
    expect(sql).toContain("get_public_chunk_meta(");
    expect(sql).toContain("left join lateral app_private.get_public_chunk(");
    expect(
      sql.match(/app_private\.get_public_chunk(?:_meta)?\(/gu),
    ).toHaveLength(2);
    expect(values).toEqual(["2027", 12, 34]);
  });

  it("returns a microsecond-precise feed cursor boundary separate from the DTO timestamp", async () => {
    const database = recordingClient([
      {
        public_id: PUBLIC_ID,
        world_slug: "2027",
        x: 0,
        y: 0,
        slot_number: 1,
        nickname: null,
        category: "other",
        design_id: "basic_wood",
        visibility: "public",
        message_visibility: "owner_only",
        message_text: null,
        version: 1,
        created_at: new Date("2026-12-20T00:00:00.123Z"),
        updated_at: new Date("2026-12-20T00:00:00.123Z"),
        cursor_created_at: "2026-12-20T00:00:00.123456Z",
      },
    ]);

    const rows = await queryPublicEmaFeed(
      database.client,
      "2027",
      1,
      null,
      null,
    );
    expect(rows[0]?.cursor_created_at).toBe("2026-12-20T00:00:00.123456Z");
    expect(database.query.mock.calls[0]?.[0]).toContain("as cursor_created_at");
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
