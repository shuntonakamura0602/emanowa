import "server-only";

import { runDatabaseTransaction } from "@/server/db/transaction-core";
import type { DatabaseClient } from "@/server/db/types";
import { getAdminDatabasePool } from "./pool";

export function withAdminDatabaseTransaction<T>(
  actorId: string,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  return runDatabaseTransaction(getAdminDatabasePool(), { actorId }, operation);
}
