import "server-only";

import { Pool } from "pg";

import { getServerRuntimeConfig } from "@/server/config";
import { createApplicationDatabasePoolConfig } from "@/server/config/database";
import { DatabaseConfigurationError } from "@/server/db/errors";
import type { DatabasePool } from "@/server/db/types";

let pool: Pool | undefined;

export function getDatabasePool(): DatabasePool {
  if (pool) return pool;

  const { dataMode, database } = getServerRuntimeConfig();
  if (dataMode !== "database") {
    throw new DatabaseConfigurationError(
      "DB接続はEMANOWA_DATA_MODE=databaseの場合だけ利用できます。",
    );
  }
  if (!database.connection) {
    throw new DatabaseConfigurationError();
  }
  if (database.connection.roleName !== "emanowa_app") {
    throw new DatabaseConfigurationError(
      "DATABASE_URLにはemanowa_appの限定接続を指定してください。",
    );
  }

  pool = new Pool(
    createApplicationDatabasePoolConfig(database.connection, "emanowa-bff"),
  );

  pool.on("error", () => {
    console.error(
      "[emanowa:db] アイドル接続でデータベースエラーが発生しました。",
    );
  });

  return pool;
}
