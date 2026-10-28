import "server-only";

import { getDatabasePool } from "@/server/db/pool";
import { runDatabaseTransaction } from "@/server/db/transaction-core";
import type { DatabaseClient, TransactionContext } from "@/server/db/types";

export function withDatabaseTransaction<T>(
  context: TransactionContext,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  return runDatabaseTransaction(getDatabasePool(), context, operation);
}
