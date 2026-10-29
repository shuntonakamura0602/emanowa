import "server-only";

import { Pool } from "pg";

import { getServerRuntimeConfig } from "@/server/config";
import { createApplicationDatabasePoolConfig } from "@/server/config/database";
import { DatabaseConfigurationError } from "@/server/db/errors";
import type { DatabasePool } from "@/server/db/types";

let adminPool: Pool | undefined;

export function getAdminDatabasePool(): DatabasePool {
  if (adminPool) return adminPool;

  const { dataMode, database } = getServerRuntimeConfig();
  if (dataMode !== "database") {
    throw new DatabaseConfigurationError(
      "管理DB接続はEMANOWA_DATA_MODE=databaseの場合だけ利用できます。",
    );
  }
  if (!database.adminConnection || !database.adminConfigured) {
    throw new DatabaseConfigurationError("管理DB接続が設定されていません。");
  }
  if (database.adminConnection.roleName !== "emanowa_admin_app") {
    throw new DatabaseConfigurationError(
      "ADMIN_DATABASE_URLにはemanowa_admin_appの限定接続を指定してください。",
    );
  }

  adminPool = new Pool(
    createApplicationDatabasePoolConfig(
      database.adminConnection,
      "emanowa-admin-bff",
    ),
  );

  adminPool.on("error", () => {
    console.error(
      "[emanowa:admin-db] アイドル接続でデータベースエラーが発生しました。",
    );
  });
  return adminPool;
}
