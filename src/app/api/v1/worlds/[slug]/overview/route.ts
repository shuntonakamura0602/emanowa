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
  publicOverviewJsonResponse,
} from "@/server/api/response";
import { getPublicOverview } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cellSizeQuerySchema = z
  .enum(["20", "100"])
  .transform((value) => Number(value) as 20 | 100);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const query = new URL(request.url).searchParams;
    assertOnlyQueryKeys(query, ["cellSize"]);
    const cellSize = parseQueryValue(
      cellSizeQuerySchema,
      readSingleQueryParam(query, "cellSize") ?? "20",
      "cellSize",
    );
    const overview = await getPublicOverview(slug, cellSize);
    if (!overview) {
      throw new ApiRouteError("NOT_FOUND", "指定された年は見つかりません。");
    }
    return publicOverviewJsonResponse(overview);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
