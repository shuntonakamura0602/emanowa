import "server-only";

import { createHash } from "node:crypto";

import {
  createEmaInputSchema,
  idempotencyKeySchema,
  publicIdSchema,
  worldSlugSchema,
  type CreateEmaInput,
} from "@/domain";
import { getServerRuntimeConfig } from "@/server/config";
import {
  queryCreateEma,
  queryOwnerEma,
  queryPublicEma,
  queryPublicWorld,
} from "@/server/db/queries";
import { withDatabaseTransaction } from "@/server/db/transaction";
import { actorIdSchema } from "@/server/db/validation";
import {
  mapCreateEmaRow,
  mapOwnerEmaRow,
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
