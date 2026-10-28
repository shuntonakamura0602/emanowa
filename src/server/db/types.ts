import type { QueryResult, QueryResultRow } from "pg";

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(error?: Error | boolean): void;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
}

export type TransactionContext = {
  actorId: string | null;
  publicLookupId?: string | null;
};
