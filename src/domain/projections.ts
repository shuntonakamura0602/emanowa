import {
  chunkCellSchema,
  occupiedChunkCellSchema,
  publicEmaSchema,
  type ChunkCell,
  type OwnerEma,
  type PublicEma,
} from "./schemas";

export type EmaProjectionSource = Pick<
  OwnerEma,
  | "publicId"
  | "worldSlug"
  | "x"
  | "y"
  | "slotNumber"
  | "nickname"
  | "category"
  | "designId"
  | "visibility"
  | "messageVisibility"
  | "wishText"
  | "status"
  | "version"
  | "createdAt"
  | "updatedAt"
>;

export type OccupiedChunkCell = Extract<ChunkCell, { kind: "occupied" }>;

/**
 * 個別URL向けの公開投影を作る。hidden は存在しないものとして扱うため null。
 * owner_only の wishText は公開オブジェクトへコピーしない。
 */
export function projectPublicEma(
  source: EmaProjectionSource,
): PublicEma | null {
  if (source.status !== "active") {
    return null;
  }

  return publicEmaSchema.parse({
    publicId: source.publicId,
    worldSlug: source.worldSlug,
    x: source.x,
    y: source.y,
    slotNumber: source.slotNumber,
    nickname: source.nickname,
    category: source.category,
    designId: source.designId,
    visibility: source.visibility,
    messageVisibility: source.messageVisibility,
    messageText: source.messageVisibility === "public" ? source.wishText : null,
    version: source.version,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  });
}

/**
 * 内部ID・公開ID・名前・本文を持たない占有プレースホルダーを作る。
 */
export function projectOccupiedChunkCell(
  source: Pick<EmaProjectionSource, "x" | "y" | "slotNumber">,
): OccupiedChunkCell {
  return occupiedChunkCellSchema.parse({
    kind: "occupied",
    x: source.x,
    y: source.y,
    slotNumber: source.slotNumber,
  });
}

/**
 * 地図チャンク向けの投影を作る。unlisted と hidden は座標の占有だけを公開する。
 */
export function projectChunkCell(source: EmaProjectionSource): ChunkCell {
  if (source.status === "hidden" || source.visibility === "unlisted") {
    return projectOccupiedChunkCell(source);
  }

  const ema = projectPublicEma(source);
  if (ema === null) {
    throw new Error("activeな絵馬だけを公開チャンクへ投影できます");
  }

  return chunkCellSchema.parse({ kind: "public", ema });
}
