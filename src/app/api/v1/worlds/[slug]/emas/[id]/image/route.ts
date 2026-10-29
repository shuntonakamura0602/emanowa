import { z } from "zod";

import { publicIdSchema, worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertOnlyQueryKeys,
  parseQueryValue,
  readSingleQueryParam,
} from "@/server/api/request";
import { apiErrorResponse } from "@/server/api/response";
import { getPublicEma } from "@/server/ema/repository";
import {
  EMA_IMAGE_VARIANTS,
  publicEmaImageFingerprint,
} from "@/server/share/ema-image-model";
import { renderEmaImage } from "@/server/share/ema-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const imageVariantSchema = z.enum(EMA_IMAGE_VARIANTS);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug, id: rawId } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const publicId = parseQueryValue(publicIdSchema, rawId, "publicId");
    const query = new URL(request.url).searchParams;
    assertOnlyQueryKeys(query, ["variant"]);
    const variant = parseQueryValue(
      imageVariantSchema,
      readSingleQueryParam(query, "variant") ?? "og",
      "variant",
    );

    let current = await getPublicEma(slug, publicId);
    if (!current) {
      throw new ApiRouteError("NOT_FOUND", "絵馬が見つかりません。");
    }

    let bytes = await renderEmaImage(current, variant);
    let verified = await getPublicEma(slug, publicId);
    if (!verified) {
      throw new ApiRouteError("NOT_FOUND", "絵馬が見つかりません。");
    }

    if (
      publicEmaImageFingerprint(verified) !== publicEmaImageFingerprint(current)
    ) {
      current = verified;
      bytes = await renderEmaImage(current, variant);
      verified = await getPublicEma(slug, publicId);
      if (!verified) {
        throw new ApiRouteError("NOT_FOUND", "絵馬が見つかりません。");
      }
      if (
        publicEmaImageFingerprint(verified) !==
        publicEmaImageFingerprint(current)
      ) {
        throw new ApiRouteError(
          "TEMPORARILY_UNAVAILABLE",
          "共有画像を更新しています。時間をおいて再試行してください。",
        );
      }
    }

    // Copy into an ArrayBuffer-backed view so the DOM Response body never
    // receives a SharedArrayBuffer-compatible Node.js buffer type.
    const body = Uint8Array.from(bytes).buffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        ...(current.visibility === "unlisted"
          ? { "X-Robots-Tag": "noindex, noimageindex, noarchive" }
          : {}),
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
