import { z } from "zod";

import {
  categorySchema,
  publicIdSchema,
  utcIsoDateTimeSchema,
  worldSlugSchema,
  type Category,
} from "@/domain";
import { ApiRouteError } from "@/server/api/errors";

const publicCursorCreatedAtSchema = utcIsoDateTimeSchema.regex(
  /\.\d{6}Z$/u,
  "cursor日時はマイクロ秒精度の正規形で指定してください",
);

const cursorSchema = z
  .object({
    v: z.literal(1),
    worldSlug: worldSlugSchema,
    category: categorySchema.nullable(),
    order: z.literal("newest"),
    createdAt: publicCursorCreatedAtSchema,
    publicId: publicIdSchema,
  })
  .strict();

export const publicFeedLimitQuerySchema = z
  .string()
  .regex(/^(?:[1-9]|[1-4]\d|50)$/u)
  .transform(Number);

export type PublicEmaCursor = {
  worldSlug: string;
  category: Category | null;
  order: "newest";
  createdAt: string;
  publicId: string;
};

export function encodePublicEmaCursor(cursor: PublicEmaCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
    "base64url",
  );
}

export function decodePublicEmaCursor(
  value: string | null,
  expected: { worldSlug: string; category: Category | null },
): Pick<PublicEmaCursor, "createdAt" | "publicId"> | null {
  if (value === null) return null;
  if (
    value.length === 0 ||
    value.length > 768 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    if (
      encodePublicEmaCursor(parsed) !== value ||
      parsed.worldSlug !== expected.worldSlug ||
      parsed.category !== expected.category
    ) {
      throw new Error("cursor scope mismatch");
    }
    return { createdAt: parsed.createdAt, publicId: parsed.publicId };
  } catch {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }
}
