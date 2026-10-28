import type { QueryResultRow } from "pg";

import type { CreateEmaInput, DeleteEmaInput, UpdateEmaInput } from "@/domain";
import type { DatabaseClient } from "@/server/db/types";

type DatabaseTimestamp = Date | string;
type DatabaseCount = bigint | number | string;

export interface PublicWorldRow extends QueryResultRow {
  world_slug: string;
  world_name: string;
  world_state: string;
  width: number;
  height: number;
  opens_at: DatabaseTimestamp;
  closes_at: DatabaseTimestamp;
  accepting_posts: boolean;
  occupied_count: DatabaseCount;
  active_count: DatabaseCount;
  listed_count: DatabaseCount;
  stats_as_of: DatabaseTimestamp;
  server_time: DatabaseTimestamp;
}

export interface PublicEmaRow extends QueryResultRow {
  public_id: string;
  world_slug: string;
  x: number;
  y: number;
  slot_number: number;
  nickname: string | null;
  category: string;
  design_id: string;
  visibility: string;
  message_visibility: string;
  message_text: string | null;
  version: number;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
}

export interface OwnerEmaRow extends QueryResultRow {
  public_id: string;
  world_slug: string;
  x: number;
  y: number;
  slot_number: number;
  nickname: string | null;
  category: string;
  design_id: string;
  visibility: string;
  message_visibility: string;
  wish_text: string;
  status: string;
  version: number;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
  edit_content: boolean;
  visibility_mode: string;
  can_delete: boolean;
}

export interface OwnerWorldRow extends QueryResultRow {
  world_slug: string;
  world_name: string;
  world_state: string;
  public_id: string;
  slot_number: number;
  status: string;
  design_id: string;
  visibility: string;
  message_visibility: string;
  version: number;
  updated_at: DatabaseTimestamp;
}

export interface CreateEmaRow extends QueryResultRow {
  public_id: string;
  world_slug: string;
  version: number;
  result: string;
  canonical_url: string;
  replayed: boolean;
}

export type MutationEmaRow = CreateEmaRow;

export async function queryPublicWorld(
  client: DatabaseClient,
  worldSlug: string,
): Promise<PublicWorldRow | null> {
  const result = await client.query<PublicWorldRow>(
    `select world_result.*, transaction_timestamp() as server_time
       from app_private.get_public_world($1::text) as world_result`,
    [worldSlug],
  );
  return result.rows[0] ?? null;
}

export async function queryPublicEma(
  client: DatabaseClient,
  worldSlug: string,
  publicId: string,
): Promise<PublicEmaRow | null> {
  const result = await client.query<PublicEmaRow>(
    "select * from app_private.get_public_ema($1::text, $2::uuid)",
    [worldSlug, publicId],
  );
  return result.rows[0] ?? null;
}

export async function queryOwnerEma(
  client: DatabaseClient,
  worldSlug: string,
): Promise<OwnerEmaRow | null> {
  const result = await client.query<OwnerEmaRow>(
    "select * from app_private.get_owner_ema($1::text)",
    [worldSlug],
  );
  return result.rows[0] ?? null;
}

export async function queryOwnerWorlds(
  client: DatabaseClient,
  limit: number,
  cursor: { updatedAt: string; publicId: string } | null,
): Promise<OwnerWorldRow[]> {
  const result = await client.query<OwnerWorldRow>(
    `select * from app_private.list_owner_worlds(
      $1::integer, $2::timestamptz, $3::uuid
    )`,
    [limit, cursor?.updatedAt ?? null, cursor?.publicId ?? null],
  );
  return result.rows;
}

export async function queryCreateEma(
  client: DatabaseClient,
  worldSlug: string,
  input: CreateEmaInput,
  idempotencyKey: string,
  requestHash: Buffer,
): Promise<CreateEmaRow> {
  const result = await client.query<CreateEmaRow>(
    `select * from app_private.create_ema(
      $1::text, $2::integer, $3::integer, $4::text, $5::text,
      $6::text, $7::text, $8::text, $9::text, $10::uuid, $11::bytea
    )`,
    [
      worldSlug,
      input.x,
      input.y,
      input.wishText,
      input.nickname ?? null,
      input.category,
      input.designId,
      input.visibility,
      input.messageVisibility,
      idempotencyKey,
      requestHash,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("create_ema returned no receipt");
  }
  return row;
}

export async function queryUpdateEma(
  client: DatabaseClient,
  publicId: string,
  input: UpdateEmaInput,
  idempotencyKey: string,
  requestHash: Buffer,
): Promise<MutationEmaRow> {
  const result = await client.query<MutationEmaRow>(
    `select * from app_private.update_ema(
      $1::uuid, $2::integer,
      $3::boolean, $4::text,
      $5::boolean, $6::text,
      $7::boolean, $8::text,
      $9::boolean, $10::text,
      $11::boolean, $12::text,
      $13::boolean, $14::text,
      $15::uuid, $16::bytea
    )`,
    [
      publicId,
      input.expectedVersion,
      input.wishText !== undefined,
      input.wishText ?? null,
      input.nickname !== undefined,
      input.nickname ?? null,
      input.category !== undefined,
      input.category ?? null,
      input.designId !== undefined,
      input.designId ?? null,
      input.visibility !== undefined,
      input.visibility ?? null,
      input.messageVisibility !== undefined,
      input.messageVisibility ?? null,
      idempotencyKey,
      requestHash,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("update_ema returned no receipt");
  return row;
}

export async function queryDeleteEma(
  client: DatabaseClient,
  publicId: string,
  input: DeleteEmaInput,
  idempotencyKey: string,
  requestHash: Buffer,
): Promise<MutationEmaRow> {
  const result = await client.query<MutationEmaRow>(
    `select * from app_private.delete_ema(
      $1::uuid, $2::integer, $3::uuid, $4::bytea
    )`,
    [publicId, input.expectedVersion, idempotencyKey, requestHash],
  );

  const row = result.rows[0];
  if (!row) throw new Error("delete_ema returned no receipt");
  return row;
}
