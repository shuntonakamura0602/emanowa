import "server-only";

import { createHash } from "node:crypto";

import type { QueryResultRow } from "pg";
import { z } from "zod";

import { idempotencyKeySchema, publicIdSchema, uuidV4Schema } from "@/domain";
import type { DatabaseClient } from "@/server/db/types";
import { actorIdSchema } from "@/server/db/validation";
import {
  adminReportSchema,
  moderationInputSchema,
  moderationReceiptSchema,
  reportStateReceiptSchema,
  reportStateSchema,
  updateReportInputSchema,
  type AdminReport,
  type ModerationInput,
  type ReportState,
  type UpdateReportInput,
} from "./contracts";
import type { AdminReportCursor } from "./cursor";
import { withAdminDatabaseTransaction } from "./transaction";

type DatabaseTimestamp = Date | string;
type DatabaseCount = bigint | number | string;

interface AdminReportRow extends QueryResultRow {
  report_id: string;
  reason: string;
  detail: string | null;
  report_state: string;
  report_version: DatabaseCount;
  created_at: DatabaseTimestamp;
  resolved_at: DatabaseTimestamp | null;
  ema_public_id: string;
  world_slug: string;
  slot_number: DatabaseCount;
  ema_status: string;
  ema_version: DatabaseCount;
  nickname: string | null;
  category: string;
  design_id: string;
  visibility: string;
  message_visibility: string;
  message_text: string | null;
}

interface ModerationRow extends QueryResultRow {
  public_id: string;
  world_slug: string;
  status: string;
  version: DatabaseCount;
  replayed: boolean;
}

interface ReportStateRow extends QueryResultRow {
  report_id: string;
  state: string;
  version: DatabaseCount;
  replayed: boolean;
}

interface AdminCheckRow extends QueryResultRow {
  allowed: boolean;
}

function asUtcIso(value: DatabaseTimestamp): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid timestamp");
  return date.toISOString();
}

function asInteger(value: DatabaseCount): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid integer");
  return parsed;
}

export function mapAdminReportRow(row: AdminReportRow): AdminReport {
  return adminReportSchema.parse({
    reportId: row.report_id,
    reason: row.reason,
    detail: row.detail,
    state: row.report_state,
    version: asInteger(row.report_version),
    createdAt: asUtcIso(row.created_at),
    resolvedAt: row.resolved_at === null ? null : asUtcIso(row.resolved_at),
    ema: {
      publicId: row.ema_public_id,
      worldSlug: row.world_slug,
      slotNumber: asInteger(row.slot_number),
      status: row.ema_status,
      version: asInteger(row.ema_version),
      nickname: row.nickname,
      category: row.category,
      designId: row.design_id,
      visibility: row.visibility,
      messageVisibility: row.message_visibility,
      messageText: row.message_text,
    },
  });
}

export async function isCurrentAdmin(actorIdInput: string): Promise<boolean> {
  const actorId = actorIdSchema.parse(actorIdInput);
  return withAdminDatabaseTransaction(actorId, async (client) => {
    const result = await client.query<AdminCheckRow>(
      "select app_private.is_current_admin() as allowed",
    );
    return result.rows[0]?.allowed === true;
  });
}

async function queryAdminReports(
  client: DatabaseClient,
  state: ReportState,
  limit: number,
  cursor: AdminReportCursor | null,
): Promise<AdminReportRow[]> {
  const result = await client.query<AdminReportRow>(
    `select * from app_private.list_admin_reports(
       $1::text, $2::integer, $3::timestamptz, $4::uuid
     )`,
    [state, limit, cursor?.createdAt ?? null, cursor?.reportId ?? null],
  );
  return result.rows;
}

export async function listAdminReports(
  actorIdInput: string,
  stateInput: unknown,
  limitInput: unknown,
  cursor: AdminReportCursor | null,
): Promise<{ items: AdminReport[]; next: AdminReportCursor | null }> {
  const actorId = actorIdSchema.parse(actorIdInput);
  const state = reportStateSchema.parse(stateInput);
  const limit = z.number().int().min(1).max(50).parse(limitInput);

  return withAdminDatabaseTransaction(actorId, async (client) => {
    const rows = await queryAdminReports(client, state, limit, cursor);
    const items = rows.map(mapAdminReportRow);
    const last = items.at(-1);
    if (!last || items.length < limit) return { items, next: null };

    const next = { createdAt: last.createdAt, reportId: last.reportId };
    const probe = await queryAdminReports(client, state, 1, next);
    return { items, next: probe.length > 0 ? next : null };
  });
}

function moderationRequestHash(
  publicId: string,
  input: ModerationInput,
): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        path: `/api/v1/admin/emas/${publicId}/moderation`,
        method: "POST",
        body: {
          action: input.action,
          reasonCode: input.reasonCode,
          expectedVersion: input.expectedVersion,
        },
      }),
      "utf8",
    )
    .digest();
}

export async function moderateEma(
  actorIdInput: string,
  publicIdInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const publicId = publicIdSchema.parse(publicIdInput);
  const input = moderationInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = moderationRequestHash(publicId, input);

  const row = await withAdminDatabaseTransaction(actorId, async (client) => {
    const result = await client.query<ModerationRow>(
      `select * from app_private.moderate_ema(
         $1::uuid, $2::text, $3::text, $4::integer, $5::uuid, $6::bytea
       )`,
      [
        publicId,
        input.action,
        input.reasonCode,
        input.expectedVersion,
        idempotencyKey,
        requestHash,
      ],
    );
    return result.rows[0];
  });
  if (!row) throw new Error("moderation result missing");
  return moderationReceiptSchema.parse({
    publicId: row.public_id,
    worldSlug: row.world_slug,
    version: asInteger(row.version),
    result: input.action === "delete" ? "deleted" : "updated",
    canonicalUrl: `/w/${row.world_slug}/e/${row.public_id}`,
  });
}

function reportStateRequestHash(
  reportId: string,
  input: UpdateReportInput,
): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        path: `/api/v1/admin/reports/${reportId}`,
        method: "PATCH",
        body: {
          state: input.state,
          expectedVersion: input.expectedVersion,
        },
      }),
      "utf8",
    )
    .digest();
}

export async function updateReportState(
  actorIdInput: string,
  reportIdInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const reportId = uuidV4Schema.parse(reportIdInput);
  const input = updateReportInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = reportStateRequestHash(reportId, input);

  const row = await withAdminDatabaseTransaction(actorId, async (client) => {
    const result = await client.query<ReportStateRow>(
      `select * from app_private.update_report(
         $1::uuid, $2::text, $3::integer, $4::uuid, $5::bytea
       )`,
      [
        reportId,
        input.state,
        input.expectedVersion,
        idempotencyKey,
        requestHash,
      ],
    );
    return result.rows[0];
  });
  if (!row) throw new Error("report state result missing");
  return reportStateReceiptSchema.parse({
    reportId: row.report_id,
    state: row.state,
    version: asInteger(row.version),
  });
}
