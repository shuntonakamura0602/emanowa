import type { PublicCapabilities } from "@/config/public";
import {
  chunkResponseSchema,
  mutationReceiptSchema,
  nearbyResponseSchema,
  occupiedChunkCellSchema,
  overviewResponseSchema,
  ownerWorldSummarySchema,
  ownerEmaSchema,
  publicChunkCellSchema,
  publicEmaSchema,
  worldResponseSchema,
  type ChunkCell,
  type ChunkResponse,
  type MutationReceipt,
  type NearbyResponse,
  type OverviewCellSize,
  type OverviewResponse,
  type OwnerEma,
  type OwnerWorldSummary,
  type PublicEma,
  type WorldResponse,
} from "@/domain";
import type {
  CreateEmaRow,
  MutationEmaRow,
  NearbyRow,
  OwnerEmaRow,
  OwnerWorldRow,
  PublicChunkCellRow,
  PublicChunkJoinedRow,
  PublicEmaRow,
  PublicOverviewJoinedRow,
  PublicWorldRow,
} from "@/server/db/queries";

export function mapNearbyRows(rows: NearbyRow[]): NearbyResponse | null {
  const first = rows[0];
  if (!first) return null;

  const candidates = rows.flatMap((row, index) => {
    if (
      row.origin_x !== first.origin_x ||
      row.origin_y !== first.origin_y ||
      row.searched_radius !== first.searched_radius
    ) {
      throw new Error(`nearby candidate ${index} does not match its metadata`);
    }
    if (
      row.candidate_x === null ||
      row.candidate_y === null ||
      row.slot_number === null
    ) {
      if (
        rows.length !== 1 ||
        row.candidate_x !== null ||
        row.candidate_y !== null ||
        row.slot_number !== null
      ) {
        throw new Error("nearby returned a partial empty candidate");
      }
      return [];
    }
    return [
      {
        x: row.candidate_x,
        y: row.candidate_y,
        slotNumber: row.slot_number,
      },
    ];
  });

  return nearbyResponseSchema.parse({
    origin: { x: first.origin_x, y: first.origin_y },
    candidates,
    searchedRadius: first.searched_radius,
  });
}

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

export function mapListedPublicEmaRow(row: PublicEmaRow): PublicEma {
  const ema = mapPublicEmaRow(row);
  if (ema.visibility !== "public") {
    throw new Error("enumeration returned an unlisted ema");
  }
  return ema;
}

export function mapPublicOverviewRows(
  rows: PublicOverviewJoinedRow[],
  cellSize: OverviewCellSize,
): OverviewResponse | null {
  const first = rows[0];
  if (!first) return null;

  return overviewResponseSchema.parse({
    cellSize,
    cells: rows.flatMap((row, index) => {
      if (row.cell_size === null) {
        if (
          rows.length !== 1 ||
          row.cell_world_slug !== null ||
          row.x !== null ||
          row.y !== null ||
          row.occupied_count !== null ||
          row.active_count !== null ||
          row.listed_count !== null ||
          row.cell_as_of !== null
        ) {
          throw new Error("overview returned a partial empty cell");
        }
        return [];
      }
      if (
        row.meta_world_slug !== first.meta_world_slug ||
        row.cell_world_slug !== first.meta_world_slug ||
        row.cell_size !== cellSize ||
        row.x === null ||
        row.y === null ||
        row.occupied_count === null ||
        row.active_count === null ||
        row.listed_count === null ||
        row.cell_as_of === null
      ) {
        throw new Error(`overview cell ${index} does not match its metadata`);
      }
      return [
        {
          x: row.x,
          y: row.y,
          occupiedCount: safeCount(row.occupied_count),
          activeCount: safeCount(row.active_count),
          listedCount: safeCount(row.listed_count),
        },
      ];
    }),
    asOf: isoTimestamp(first.meta_as_of),
  });
}

function requirePublicChunkProjection(row: PublicChunkCellRow): PublicEmaRow {
  if (
    row.public_id === null ||
    row.world_slug === null ||
    row.category === null ||
    row.design_id === null ||
    row.visibility === null ||
    row.message_visibility === null ||
    row.version === null ||
    row.created_at === null ||
    row.updated_at === null
  ) {
    throw new Error("public chunk cell is missing its fixed projection");
  }
  return {
    public_id: row.public_id,
    world_slug: row.world_slug,
    x: row.x,
    y: row.y,
    slot_number: row.slot_number,
    nickname: row.nickname,
    category: row.category,
    design_id: row.design_id,
    visibility: row.visibility,
    message_visibility: row.message_visibility,
    message_text: row.message_text,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapPublicChunkCellRow(row: PublicChunkCellRow): ChunkCell {
  if (row.kind === "public") {
    return publicChunkCellSchema.parse({
      kind: "public",
      ema: mapPublicEmaRow(requirePublicChunkProjection(row)),
    });
  }
  if (row.kind !== "occupied") {
    throw new Error("database returned an unknown chunk cell kind");
  }
  if (
    row.public_id !== null ||
    row.nickname !== null ||
    row.category !== null ||
    row.design_id !== null ||
    row.visibility !== null ||
    row.message_visibility !== null ||
    row.message_text !== null ||
    row.version !== null ||
    row.created_at !== null ||
    row.updated_at !== null
  ) {
    throw new Error("occupied chunk cell contained discoverable ema data");
  }
  return occupiedChunkCellSchema.parse({
    kind: "occupied",
    x: row.x,
    y: row.y,
    slotNumber: row.slot_number,
  });
}

export function mapPublicChunkRows(
  rows: PublicChunkJoinedRow[],
): ChunkResponse | null {
  const first = rows[0];
  if (!first) return null;

  const cells = rows.flatMap((row, index) => {
    if (row.kind === null) {
      if (
        rows.length !== 1 ||
        row.public_id !== null ||
        row.cell_world_slug !== null ||
        row.x !== null ||
        row.y !== null ||
        row.slot_number !== null ||
        row.nickname !== null ||
        row.category !== null ||
        row.design_id !== null ||
        row.visibility !== null ||
        row.message_visibility !== null ||
        row.message_text !== null ||
        row.version !== null ||
        row.created_at !== null ||
        row.updated_at !== null
      ) {
        throw new Error("chunk returned a partial empty cell");
      }
      return [];
    }
    if (
      row.meta_world_slug !== first.meta_world_slug ||
      row.meta_cx !== first.meta_cx ||
      row.meta_cy !== first.meta_cy ||
      row.cell_world_slug !== first.meta_world_slug ||
      row.x === null ||
      row.y === null ||
      row.slot_number === null
    ) {
      throw new Error(`chunk cell ${index} does not match its metadata`);
    }
    return [
      mapPublicChunkCellRow({
        kind: row.kind,
        public_id: row.public_id,
        world_slug: row.cell_world_slug,
        x: row.x,
        y: row.y,
        slot_number: row.slot_number,
        nickname: row.nickname,
        category: row.category,
        design_id: row.design_id,
        visibility: row.visibility,
        message_visibility: row.message_visibility,
        message_text: row.message_text,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    ];
  });

  return chunkResponseSchema.parse({
    worldSlug: first.meta_world_slug,
    cx: first.meta_cx,
    cy: first.meta_cy,
    revision: safeCount(first.meta_revision),
    cells,
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

export function mapOwnerWorldRow(row: OwnerWorldRow): OwnerWorldSummary {
  return ownerWorldSummarySchema.parse({
    worldSlug: row.world_slug,
    worldName: row.world_name,
    worldState: row.world_state,
    ema: {
      publicId: row.public_id,
      slotNumber: row.slot_number,
      status: row.status,
      designId: row.design_id,
      visibility: row.visibility,
      messageVisibility: row.message_visibility,
      version: row.version,
      updatedAt: isoTimestamp(row.updated_at),
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

export function mapMutationEmaRow(row: MutationEmaRow): {
  receipt: MutationReceipt;
  replayed: boolean;
} {
  return mapCreateEmaRow(row);
}
