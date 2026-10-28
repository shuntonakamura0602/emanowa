import type { PublicCapabilities } from "@/config/public";
import {
  mutationReceiptSchema,
  ownerEmaSchema,
  publicEmaSchema,
  worldResponseSchema,
  type MutationReceipt,
  type OwnerEma,
  type PublicEma,
  type WorldResponse,
} from "@/domain";
import type {
  CreateEmaRow,
  OwnerEmaRow,
  PublicEmaRow,
  PublicWorldRow,
} from "@/server/db/queries";

function isoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function safeCount(value: bigint | number | string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("database count is outside the safe integer range");
  }
  return count;
}

export function mapPublicWorldRow(
  row: PublicWorldRow,
  capabilities: PublicCapabilities,
): WorldResponse {
  return worldResponseSchema.parse({
    world: {
      slug: row.world_slug,
      name: row.world_name,
      state: row.world_state,
      width: row.width,
      height: row.height,
      opensAt: isoTimestamp(row.opens_at),
      closesAt: isoTimestamp(row.closes_at),
      acceptingPosts: row.accepting_posts,
    },
    serverTime: isoTimestamp(row.server_time),
    stats: {
      occupiedCount: safeCount(row.occupied_count),
      activeCount: safeCount(row.active_count),
      listedCount: safeCount(row.listed_count),
      asOf: isoTimestamp(row.stats_as_of),
    },
    capabilities,
  });
}

export function mapPublicEmaRow(row: PublicEmaRow): PublicEma {
  return publicEmaSchema.parse({
    publicId: row.public_id,
    worldSlug: row.world_slug,
    x: row.x,
    y: row.y,
    slotNumber: row.slot_number,
    nickname: row.nickname,
    category: row.category,
    designId: row.design_id,
    visibility: row.visibility,
    messageVisibility: row.message_visibility,
    messageText: row.message_text,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  });
}

export function mapOwnerEmaRow(row: OwnerEmaRow): OwnerEma {
  return ownerEmaSchema.parse({
    publicId: row.public_id,
    worldSlug: row.world_slug,
    x: row.x,
    y: row.y,
    slotNumber: row.slot_number,
    nickname: row.nickname,
    category: row.category,
    designId: row.design_id,
    visibility: row.visibility,
    messageVisibility: row.message_visibility,
    wishText: row.wish_text,
    status: row.status,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    capabilities: {
      editContent: row.edit_content,
      visibilityMode: row.visibility_mode,
      delete: row.can_delete,
    },
  });
}

export function mapCreateEmaRow(row: CreateEmaRow): {
  receipt: MutationReceipt;
  replayed: boolean;
} {
  return {
    receipt: mutationReceiptSchema.parse({
      publicId: row.public_id,
      worldSlug: row.world_slug,
      version: row.version,
      result: row.result,
      canonicalUrl: row.canonical_url,
    }),
    replayed: row.replayed,
  };
}
