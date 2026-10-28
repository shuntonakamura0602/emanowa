import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import { DatabaseOperationError } from "@/server/db/errors";
import { runDatabaseTransaction } from "@/server/db/transaction-core";
import type { DatabaseClient, DatabasePool } from "@/server/db/types";

const ACTOR_A = "11111111-1111-4111-8111-111111111111";
const ACTOR_B = "22222222-2222-4222-8222-222222222222";
const PUBLIC_ID = "33333333-3333-4333-8333-333333333333";

function emptyResult<
  Row extends QueryResultRow = QueryResultRow,
>(): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };
}

function fakeDatabase() {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const release = vi.fn();
  const query = vi.fn(
    async (text: string, values?: unknown[]): Promise<QueryResult> => {
      calls.push({ text, values });
      return emptyResult();
    },
  );
  const client = { query, release } as unknown as DatabaseClient;
  const pool = {
    connect: vi.fn(async () => client),
  } satisfies DatabasePool;
  return { calls, client, pool, query, release };
}

describe("runDatabaseTransaction", () => {
  it("sets empty public context inside the transaction and releases the client", async () => {
    const database = fakeDatabase();
    const value = await runDatabaseTransaction(
      database.pool,
      { actorId: null },
      async () => "ok",
    );

    expect(value).toBe("ok");
    expect(database.calls).toEqual([
      { text: "begin", values: undefined },
      {
        text: "select set_config('app.actor_id', $1, true)",
        values: [""],
      },
      {
        text: "select set_config('app.lookup_public_id', $1, true)",
        values: [""],
      },
      { text: "commit", values: undefined },
    ]);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("sets verified actor and direct lookup id before the operation", async () => {
    const database = fakeDatabase();
    await runDatabaseTransaction(
      database.pool,
      { actorId: ACTOR_A, publicLookupId: PUBLIC_ID },
      async (client) => {
        await client.query("select operation()", []);
      },
    );

    expect(database.calls.slice(1, 4)).toEqual([
      {
        text: "select set_config('app.actor_id', $1, true)",
        values: [ACTOR_A],
      },
      {
        text: "select set_config('app.lookup_public_id', $1, true)",
        values: [PUBLIC_ID],
      },
      { text: "select operation()", values: [] },
    ]);
  });

  it("sets actor context for every transaction when a pooled client is reused", async () => {
    const database = fakeDatabase();
    await runDatabaseTransaction(
      database.pool,
      { actorId: ACTOR_A },
      async () => {},
    );
    await runDatabaseTransaction(
      database.pool,
      { actorId: ACTOR_B },
      async () => {},
    );

    const actorCalls = database.calls.filter((call) =>
      call.text.includes("app.actor_id"),
    );
    expect(actorCalls.map((call) => call.values)).toEqual([
      [ACTOR_A],
      [ACTOR_B],
    ]);
    expect(database.release).toHaveBeenCalledTimes(2);
  });

  it("rolls back and releases after an operation failure", async () => {
    const database = fakeDatabase();
    await expect(
      runDatabaseTransaction(database.pool, { actorId: ACTOR_A }, async () => {
        throw { code: "P1007" };
      }),
    ).rejects.toMatchObject({
      code: "SLOT_TAKEN",
      httpStatus: 409,
    });

    expect(database.calls.at(-1)?.text).toBe("rollback");
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("discards the connection when rollback itself fails", async () => {
    const database = fakeDatabase();
    database.query.mockImplementation(async (text: string) => {
      if (text === "rollback") throw new Error("rollback failed");
      return emptyResult();
    });

    await expect(
      runDatabaseTransaction(database.pool, { actorId: ACTOR_A }, async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toBeInstanceOf(DatabaseOperationError);

    expect(database.release).toHaveBeenCalledWith(expect.any(Error));
  });
});
