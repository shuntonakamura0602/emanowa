import "server-only";

import { Pool } from "pg";

import { getServerRuntimeConfig } from "@/server/config";
import { DatabaseConfigurationError } from "@/server/db/errors";
import type { DatabasePool } from "@/server/db/types";

let pool: Pool | undefined;

function hostedSsl(databaseUrl: string): false | { rejectUnauthorized: true } {
  const { hostname } = new URL(databaseUrl);
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return false;
  }
  return { rejectUnauthorized: true };
}

export function getDatabasePool(): DatabasePool {
  if (pool) return pool;

  const { dataMode, database } = getServerRuntimeConfig();
  if (dataMode !== "database") {
    throw new DatabaseConfigurationError(
      "DB接続はEMANOWA_DATA_MODE=databaseの場合だけ利用できます。",
    );
  }
  if (!database.url) {
    throw new DatabaseConfigurationError();
  }
  if (database.roleName !== "emanowa_app") {
    throw new DatabaseConfigurationError(
      "DATABASE_URLにはemanowa_appの限定接続を指定してください。",
    );
  }

  pool = new Pool({
    connectionString: database.url,
    application_name: "emanowa-bff",
    // A module-scoped serverless pool should keep its per-instance footprint
    // deliberately small; the external Supavisor pool handles wider fan-out.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    idle_in_transaction_session_timeout: 5_000,
    allowExitOnIdle: true,
    ssl: hostedSsl(database.url),
  });

  pool.on("error", () => {
    console.error(
      "[emanowa:db] アイドル接続でデータベースエラーが発生しました。",
    );
  });

  return pool;
}
