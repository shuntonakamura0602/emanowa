import "server-only";

import { createHash } from "node:crypto";

import {
  createEmaInputSchema,
  deleteEmaInputSchema,
  idempotencyKeySchema,
  publicIdSchema,
  updateEmaInputSchema,
  worldSlugSchema,
  type CreateEmaInput,
  type DeleteEmaInput,
  type UpdateEmaInput,
} from "@/domain";
import { getServerRuntimeConfig } from "@/server/config";
import {
  queryCreateEma,
  queryDeleteEma,
  queryOwnerEma,
  queryOwnerWorlds,
  queryPublicEma,
  queryPublicWorld,
  queryUpdateEma,
} from "@/server/db/queries";
import { withDatabaseTransaction } from "@/server/db/transaction";
import { actorIdSchema } from "@/server/db/validation";
import {
  mapCreateEmaRow,
  mapMutationEmaRow,
  mapOwnerEmaRow,
  mapOwnerWorldRow,
  mapPublicEmaRow,
  mapPublicWorldRow,
} from "@/server/ema/mappers";

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
