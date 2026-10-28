import type { QueryResultRow } from "pg";

import type {
  Category,
  CreateEmaInput,
  DeleteEmaInput,
  OverviewCellSize,
  UpdateEmaInput,
} from "@/domain";
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

export interface PublicEmaFeedRow extends PublicEmaRow {
  cursor_created_at: string;
}

export interface PublicOverviewRow extends QueryResultRow {
  world_slug: string;
  cell_size: number;
  x: number;
  y: number;
  occupied_count: DatabaseCount;
  active_count: DatabaseCount;
  listed_count: DatabaseCount;
  as_of: DatabaseTimestamp;
}

export interface PublicOverviewJoinedRow extends QueryResultRow {
  meta_world_slug: string;
  meta_as_of: DatabaseTimestamp;
  cell_world_slug: string | null;
  cell_size: number | null;
  x: number | null;
  y: number | null;
  occupied_count: DatabaseCount | null;
  active_count: DatabaseCount | null;
  listed_count: DatabaseCount | null;
  cell_as_of: DatabaseTimestamp | null;
}

export interface PublicChunkCellRow extends QueryResultRow {
  kind: string;
  public_id: string | null;
  world_slug: string | null;
  x: number;
  y: number;
  slot_number: number;
  nickname: string | null;
  category: string | null;
  design_id: string | null;
  visibility: string | null;
  message_visibility: string | null;
  message_text: string | null;
  version: number | null;
  created_at: DatabaseTimestamp | null;
  updated_at: DatabaseTimestamp | null;
}

export interface PublicChunkJoinedRow extends QueryResultRow {
  meta_world_slug: string;
  meta_cx: number;
  meta_cy: number;
  meta_revision: DatabaseCount;
  kind: string | null;
  public_id: string | null;
  cell_world_slug: string | null;
  x: number | null;
  y: number | null;
  slot_number: number | null;
  nickname: string | null;
  category: string | null;
  design_id: string | null;
  visibility: string | null;
  message_visibility: string | null;
  message_text: string | null;
  version: number | null;
  created_at: DatabaseTimestamp | null;
  updated_at: DatabaseTimestamp | null;
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

export async function queryPublicOverview(
  client: DatabaseClient,
  worldSlug: string,
  cellSize: OverviewCellSize,
): Promise<PublicOverviewJoinedRow[]> {
  const result = await client.query<PublicOverviewJoinedRow>(
    `select
       world_result.world_slug as meta_world_slug,
       world_result.stats_as_of as meta_as_of,
       overview.world_slug as cell_world_slug,
       overview.cell_size,
       overview.x,
       overview.y,
       overview.occupied_count,
       overview.active_count,
       overview.listed_count,
       overview.as_of as cell_as_of
     from app_private.get_public_world($1::text) as world_result
     left join lateral app_private.get_public_overview(
       $1::text, $2::integer
     ) as overview on true
     order by overview.y nulls first, overview.x nulls first`,
    [worldSlug, cellSize],
  );
  return result.rows;
}

export async function queryPublicChunk(
  client: DatabaseClient,
  worldSlug: string,
  cx: number,
  cy: number,
): Promise<PublicChunkJoinedRow[]> {
  const result = await client.query<PublicChunkJoinedRow>(
    `select
       meta.world_slug as meta_world_slug,
       meta.cx as meta_cx,
       meta.cy as meta_cy,
       meta.revision as meta_revision,
       cell.kind,
       cell.public_id,
       cell.world_slug as cell_world_slug,
       cell.x,
       cell.y,
       cell.slot_number,
       cell.nickname,
       cell.category,
       cell.design_id,
       cell.visibility,
       cell.message_visibility,
       cell.message_text,
       cell.version,
       cell.created_at,
       cell.updated_at
     from app_private.get_public_chunk_meta(
       $1::text, $2::integer, $3::integer
     ) as meta
     left join lateral app_private.get_public_chunk(
       $1::text, $2::integer, $3::integer
     ) as cell on true
     order by cell.y nulls first, cell.x nulls first`,
    [worldSlug, cx, cy],
  );
  return result.rows;
}

export async function queryPublicEmaFeed(
  client: DatabaseClient,
  worldSlug: string,
  limit: number,
  category: Category | null,
  cursor: { createdAt: string; publicId: string } | null,
): Promise<PublicEmaFeedRow[]> {
  const result = await client.query<PublicEmaFeedRow>(
    `select
       feed.*,
       pg_catalog.to_char(
         feed.created_at at time zone 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       ) as cursor_created_at
     from app_private.list_public_emas(
       $1::text, $2::integer, $3::text, $4::timestamptz, $5::uuid
     ) as feed`,
    [
      worldSlug,
      limit,
      category,
      cursor?.createdAt ?? null,
      cursor?.publicId ?? null,
    ],
  );
  return result.rows;
}

export async function queryRandomPublicEma(
  client: DatabaseClient,
  worldSlug: string,
  category: Category | null,
  pivot: string,
): Promise<PublicEmaRow | null> {
  const result = await client.query<PublicEmaRow>(
    "select * from app_private.get_random_public_ema($1::text, $2::text, $3::uuid)",
    [worldSlug, category, pivot],
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
