import "server-only";

import { Pool } from "pg";

import { getServerRuntimeConfig } from "@/server/config";
import { createApplicationDatabasePoolConfig } from "@/server/config/database";
import { DatabaseConfigurationError } from "@/server/db/errors";
import type { DatabasePool } from "@/server/db/types";

let adminPool: Pool | undefined;

export function getAdminDatabasePool(): DatabasePool {
  if (adminPool) return adminPool;

  const { adminOperationsAvailable, database } = getServerRuntimeConfig();
  if (!adminOperationsAvailable) {
    throw new DatabaseConfigurationError(
      "管理DB接続に必要な環境分類、database mode、origin、Auth、限定接続を確認してください。",
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

/** Read-only operational probe for the dedicated emergency/admin boundary.
 * It verifies the configured role can reach the Stage H function without
 * creating an actor context or reading any user-generated content. */
export async function probeAdminDatabase(): Promise<void> {
  const client = await getAdminDatabasePool().connect();
  try {
    const result = await client.query<{ allowed: boolean }>(
      `select pg_catalog.has_function_privilege(
         current_user,
         'app_private.get_admin_world_posting(text)',
         'execute'
       ) as allowed`,
    );
    if (result.rows[0]?.allowed !== true) {
      throw new Error("admin operation boundary unavailable");
    }
  } finally {
    client.release();
  }
}
