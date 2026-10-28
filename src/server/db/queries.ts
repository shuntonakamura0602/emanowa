import type { QueryResultRow } from "pg";

import type { CreateEmaInput } from "@/domain";
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

export interface CreateEmaRow extends QueryResultRow {
  public_id: string;
  world_slug: string;
  version: number;
  result: string;
  canonical_url: string;
  replayed: boolean;
}

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
