import { z } from "zod";

import { publicIdSchema, utcIsoDateTimeSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";

const cursorSchema = z
  .object({
    v: z.literal(1),
    updatedAt: utcIsoDateTimeSchema,
    publicId: publicIdSchema,
  })
  .strict();

export type OwnerWorldCursor = {
  updatedAt: string;
  publicId: string;
};

export function encodeOwnerWorldCursor(cursor: OwnerWorldCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
    "base64url",
  );
}

export function decodeOwnerWorldCursor(
  value: string | null,
): OwnerWorldCursor | null {
  if (value === null) return null;
  if (
    value.length === 0 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    if (encodeOwnerWorldCursor(parsed) !== value)
      throw new Error("non-canonical");
    return { updatedAt: parsed.updatedAt, publicId: parsed.publicId };
  } catch {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }
}
