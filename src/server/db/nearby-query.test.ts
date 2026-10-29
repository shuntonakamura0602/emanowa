import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import { queryNearbySlots } from "./queries";
import type { DatabaseClient } from "./types";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("nearby private database query", () => {
  it("passes either the public UUID or coordinates as positional values", async () => {
    const query = vi.fn(async () => result([]));
    const client = { query, release: vi.fn() } as unknown as DatabaseClient;

    await queryNearbySlots(client, "2027", { near: PUBLIC_ID });
    await queryNearbySlots(client, "2027", { x: 10, y: 20 });

    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("app_private.get_nearby_slots("),
      ["2027", PUBLIC_ID, null, null],
    ]);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining("app_private.get_nearby_slots("),
      ["2027", null, 10, 20],
    ]);
  });
});
