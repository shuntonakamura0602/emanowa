import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  categorySchema,
  chunkCoordinatesSchema,
  createEmaInputSchema,
  deleteEmaInputSchema,
  idempotencyKeySchema,
  nearbyQuerySchema,
  overviewCellSizeSchema,
  publicIdSchema,
  updateEmaInputSchema,
  worldSlugSchema,
  type Category,
  type CreateEmaInput,
  type DeleteEmaInput,
  type OverviewCellSize,
  type UpdateEmaInput,
} from "@/domain";
import { getServerRuntimeConfig } from "@/server/config";
import {
  queryCreateEma,
  queryDeleteEma,
  queryNearbySlots,
  queryOwnerEma,
  queryOwnerWorlds,
  queryPublicChunk,
  queryPublicEma,
  queryPublicEmaFeed,
  queryPublicOverview,
  queryPublicWorld,
  queryRandomPublicEma,
  queryUpdateEma,
} from "@/server/db/queries";
import { withDatabaseTransaction } from "@/server/db/transaction";
import { actorIdSchema } from "@/server/db/validation";
import {
  mapCreateEmaRow,
  mapListedPublicEmaRow,
  mapMutationEmaRow,
  mapNearbyRows,
  mapOwnerEmaRow,
  mapOwnerWorldRow,
  mapPublicChunkRows,
  mapPublicEmaRow,
  mapPublicOverviewRows,
  mapPublicWorldRow,
} from "@/server/ema/mappers";

const publicFeedLimitSchema = z.number().int().min(1).max(50);

function createRequestHash(worldSlug: string, input: CreateEmaInput): Buffer {
  const canonicalRequest = JSON.stringify({
    path: `/api/v1/worlds/${worldSlug}/emas`,
    body: {
      x: input.x,
      y: input.y,
      wishText: input.wishText,
      nickname: input.nickname ?? null,
      category: input.category,
      designId: input.designId,
      visibility: input.visibility,
      messageVisibility: input.messageVisibility,
    },
  });
  return createHash("sha256").update(canonicalRequest, "utf8").digest();
}

function createMutationRequestHash(
  method: "PATCH" | "DELETE",
  publicId: string,
  input: UpdateEmaInput | DeleteEmaInput,
): Buffer {
  const body =
    method === "DELETE"
      ? { expectedVersion: input.expectedVersion }
      : (() => {
          const patch = input as UpdateEmaInput;
          return {
            expectedVersion: input.expectedVersion,
            ...(patch.wishText !== undefined
              ? { wishText: patch.wishText }
              : {}),
            ...(patch.nickname !== undefined
              ? { nickname: patch.nickname }
              : {}),
            ...(patch.category !== undefined
              ? { category: patch.category }
              : {}),
            ...(patch.designId !== undefined
              ? { designId: patch.designId }
              : {}),
            ...(patch.visibility !== undefined
              ? { visibility: patch.visibility }
              : {}),
            ...(patch.messageVisibility !== undefined
              ? { messageVisibility: patch.messageVisibility }
              : {}),
          };
        })();
  const canonicalRequest = JSON.stringify({
    path: `/api/v1/me/emas/${publicId}`,
    method,
    body,
  });
  return createHash("sha256").update(canonicalRequest, "utf8").digest();
}

export async function getPublicWorld(worldSlugInput: string) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const row = await withDatabaseTransaction({ actorId: null }, (client) =>
    queryPublicWorld(client, worldSlug),
  );
  if (!row) return null;
  return mapPublicWorldRow(row, getServerRuntimeConfig().capabilities);
}

export async function getPublicEma(
  worldSlugInput: string,
  publicIdInput: string,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const publicId = publicIdSchema.parse(publicIdInput);
  const row = await withDatabaseTransaction(
    { actorId: null, publicLookupId: publicId },
    (client) => queryPublicEma(client, worldSlug, publicId),
  );
  return row ? mapPublicEmaRow(row) : null;
}

export async function getPublicOverview(
  worldSlugInput: string,
  cellSizeInput: unknown,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const cellSize: OverviewCellSize =
    overviewCellSizeSchema.parse(cellSizeInput);
  const rows = await withDatabaseTransaction({ actorId: null }, (client) =>
    queryPublicOverview(client, worldSlug, cellSize),
  );
  return mapPublicOverviewRows(rows, cellSize);
}

export async function getPublicChunk(
  worldSlugInput: string,
  chunkInput: unknown,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const chunk = chunkCoordinatesSchema.parse(chunkInput);
  const rows = await withDatabaseTransaction({ actorId: null }, (client) =>
    queryPublicChunk(client, worldSlug, chunk.cx, chunk.cy),
  );
  return mapPublicChunkRows(rows);
}

function parseCategory(value: unknown): Category | null {
  return value === null ? null : categorySchema.parse(value);
}

export async function listPublicEmas(
  worldSlugInput: string,
  limitInput: unknown,
  categoryInput: unknown,
  cursor: { createdAt: string; publicId: string } | null,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const limit = publicFeedLimitSchema.parse(limitInput);
  const category = parseCategory(categoryInput);

  return withDatabaseTransaction({ actorId: null }, async (client) => {
    const world = await queryPublicWorld(client, worldSlug);
    if (!world) return null;

    const rows = await queryPublicEmaFeed(
      client,
      worldSlug,
      limit,
      category,
      cursor,
    );
    const items = rows.map(mapListedPublicEmaRow);
    const lastRow = rows.at(-1);
    if (!lastRow || items.length < limit) {
      return { items, next: null };
    }

    const next = {
      createdAt: lastRow.cursor_created_at,
      publicId: lastRow.public_id,
    };
    const probe = await queryPublicEmaFeed(
      client,
      worldSlug,
      1,
      category,
      next,
    );
    return { items, next: probe.length > 0 ? next : null };
  });
}

export async function getRandomPublicEma(
  worldSlugInput: string,
  categoryInput: unknown,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const category = parseCategory(categoryInput);
  return withDatabaseTransaction({ actorId: null }, async (client) => {
    const world = await queryPublicWorld(client, worldSlug);
    if (!world) return undefined;
    const row = await queryRandomPublicEma(
      client,
      worldSlug,
      category,
      randomUUID(),
    );
    return row ? mapListedPublicEmaRow(row) : null;
  });
}

export async function getNearbySlots(
  worldSlugInput: string,
  queryInput: unknown,
) {
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const query = nearbyQuerySchema.parse(queryInput);
  const publicLookupId = "near" in query ? query.near : null;
  const rows = await withDatabaseTransaction(
    { actorId: null, publicLookupId },
    (client) => queryNearbySlots(client, worldSlug, query),
  );
  return mapNearbyRows(rows);
}

export async function getOwnerEma(
  actorIdInput: string,
  worldSlugInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const row = await withDatabaseTransaction({ actorId }, (client) =>
    queryOwnerEma(client, worldSlug),
  );
  return row ? mapOwnerEmaRow(row) : null;
}

export async function listOwnerWorlds(
  actorIdInput: string,
  limit: number,
  cursor: { updatedAt: string; publicId: string } | null,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const rows = await withDatabaseTransaction({ actorId }, (client) =>
    queryOwnerWorlds(client, limit + 1, cursor),
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapOwnerWorldRow);
  const last = items.at(-1);
  return {
    items,
    next:
      hasMore && last
        ? { updatedAt: last.ema.updatedAt, publicId: last.ema.publicId }
        : null,
  };
}

export async function createEma(
  actorIdInput: string,
  worldSlugInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const worldSlug = worldSlugSchema.parse(worldSlugInput);
  const input = createEmaInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = createRequestHash(worldSlug, input);

  const row = await withDatabaseTransaction({ actorId }, (client) =>
    queryCreateEma(client, worldSlug, input, idempotencyKey, requestHash),
  );
  return mapCreateEmaRow(row);
}

export async function updateEma(
  actorIdInput: string,
  publicIdInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const publicId = publicIdSchema.parse(publicIdInput);
  const input = updateEmaInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = createMutationRequestHash("PATCH", publicId, input);
  const row = await withDatabaseTransaction({ actorId }, (client) =>
    queryUpdateEma(client, publicId, input, idempotencyKey, requestHash),
  );
  return mapMutationEmaRow(row);
}

export async function deleteEma(
  actorIdInput: string,
  publicIdInput: string,
  inputValue: unknown,
  idempotencyKeyInput: string,
) {
  const actorId = actorIdSchema.parse(actorIdInput);
  const publicId = publicIdSchema.parse(publicIdInput);
  const input = deleteEmaInputSchema.parse(inputValue);
  const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyInput);
  const requestHash = createMutationRequestHash("DELETE", publicId, input);
  const row = await withDatabaseTransaction({ actorId }, (client) =>
    queryDeleteEma(client, publicId, input, idempotencyKey, requestHash),
  );
  return mapMutationEmaRow(row);
}
