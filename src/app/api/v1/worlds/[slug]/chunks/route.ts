import { z } from "zod";

import { worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertOnlyQueryKeys,
  parseQueryValue,
  readSingleQueryParam,
} from "@/server/api/request";
import {
  apiErrorResponse,
  boundedPublicJsonResponse,
} from "@/server/api/response";
import { getPublicChunk } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const chunkCoordinateQuerySchema = z
  .string()
  .regex(/^(?:0|[1-4]\d)$/u)
  .transform(Number);
const CHUNK_RESPONSE_PROTECTION_BYTES = 4 * 1024 * 1024;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const query = new URL(request.url).searchParams;
    assertOnlyQueryKeys(query, ["cx", "cy"]);
    const cx = parseQueryValue(
      chunkCoordinateQuerySchema,
      readSingleQueryParam(query, "cx"),
      "cx",
    );
    const cy = parseQueryValue(
      chunkCoordinateQuerySchema,
      readSingleQueryParam(query, "cy"),
      "cy",
    );
    const chunk = await getPublicChunk(slug, { cx, cy });
    if (!chunk) {
      throw new ApiRouteError("NOT_FOUND", "指定された年は見つかりません。");
    }
    return boundedPublicJsonResponse(chunk, CHUNK_RESPONSE_PROTECTION_BYTES);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
