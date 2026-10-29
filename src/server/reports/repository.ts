import "server-only";

import { createHash } from "node:crypto";

import type { QueryResultRow } from "pg";

import {
  createReportInputSchema,
  idempotencyKeySchema,
  publicIdSchema,
  reportReceiptSchema,
  worldSlugSchema,
  type CreateReportInput,
  type ReportReceipt,
} from "@/domain";
import { withDatabaseTransaction } from "@/server/db/transaction";
import type { DatabaseClient } from "@/server/db/types";
import { actorIdSchema } from "@/server/db/validation";

interface CreateReportRow extends QueryResultRow {
  report_id: string;
  accepted: boolean;
  replayed: boolean;
  http_status: number;
}

export type CreateReportResult = {
  receipt: ReportReceipt;
  httpStatus: 200 | 201;
  replayed: boolean;
};

function normalizedDetail(input: CreateReportInput): string | null {
  return input.detail === undefined || input.detail === ""
    ? null
    : input.detail;
}

export function createReportRequestHash(
  worldSlug: string,
  publicId: string,
  input: CreateReportInput,
): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        method: "POST",
        path: `/api/v1/worlds/${worldSlug}/emas/${publicId}/reports`,
        body: {
          reason: input.reason,
          detail: normalizedDetail(input),
        },
      }),
      "utf8",
    )
    .digest();
}

export async function queryCreateReport(
  client: DatabaseClient,
  worldSlug: string,
  publicId: string,
  input: CreateReportInput,
  idempotencyKey: string,
  requestHash: Buffer,
): Promise<CreateReportRow> {
  const result = await client.query<CreateReportRow>(
    `select * from app_private.create_report(
      $1::text, $2::uuid, $3::text, $4::text, $5::uuid, $6::bytea
    )`,
    [
      worldSlug,
      publicId,
      input.reason,
      normalizedDetail(input),
      idempotencyKey,
      requestHash,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("create_report returned no receipt");
  return row;
}

export async function createReport(
  actorIdInput: string,
  worldSlugInput: string,
  publicIdInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
): Promise<CreateReportResult> {
  const actorId = actorIdSchema.parse(actorIdInput);
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const publicId = publicIdSchema.parse(publicIdInput);
  const input = createReportInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = createReportRequestHash(worldSlug, publicId, input);
  const row = await withDatabaseTransaction({ actorId }, (client) =>
    queryCreateReport(
      client,
      worldSlug,
      publicId,
      input,
      idempotencyKey,
      requestHash,
    ),
  );
  if (row.http_status !== 200 && row.http_status !== 201) {
    throw new Error("create_report returned an invalid HTTP status");
  }
  return {
    receipt: reportReceiptSchema.parse({
      reportId: row.report_id,
      accepted: row.accepted,
    }),
    httpStatus: row.http_status,
    replayed: row.replayed,
  };
}
