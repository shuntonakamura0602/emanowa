import { publicIdSchema } from "@/domain";
import { mapDatabaseError } from "@/server/db/errors";
import type {
  DatabaseClient,
  DatabasePool,
  TransactionContext,
} from "@/server/db/types";
import { actorIdSchema } from "@/server/db/validation";

export async function runDatabaseTransaction<T>(
  pool: DatabasePool,
  context: TransactionContext,
  operation: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const actorId = context.actorId ? actorIdSchema.parse(context.actorId) : "";
  const publicLookupId = context.publicLookupId
    ? publicIdSchema.parse(context.publicLookupId)
    : "";

  let client: DatabaseClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw mapDatabaseError(error);
  }

  let transactionStarted = false;
  let releaseWithError: Error | undefined;

  try {
    await client.query("begin");
    transactionStarted = true;
    await client.query("select set_config('app.actor_id', $1, true)", [
      actorId,
    ]);
    await client.query("select set_config('app.lookup_public_id', $1, true)", [
      publicLookupId,
    ]);

    const result = await operation(client);
    await client.query("commit");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        releaseWithError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error("database rollback failed");
      }
    }
    throw mapDatabaseError(error);
  } finally {
    client.release(releaseWithError);
  }
}
