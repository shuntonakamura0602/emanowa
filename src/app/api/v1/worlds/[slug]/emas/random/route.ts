import {
  categorySchema,
  randomEmaResponseSchema,
  worldSlugSchema,
  type Category,
} from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertOnlyQueryKeys,
  parseQueryValue,
  readSingleQueryParam,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getRandomPublicEma } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const query = new URL(request.url).searchParams;
    assertOnlyQueryKeys(query, ["category"]);
    const rawCategory = readSingleQueryParam(query, "category");
    const category: Category | null =
      rawCategory === null
        ? null
        : parseQueryValue(categorySchema, rawCategory, "category");
    const item = await getRandomPublicEma(slug, category);
    if (item === undefined) {
      throw new ApiRouteError("NOT_FOUND", "指定された年は見つかりません。");
    }
    return jsonResponse(randomEmaResponseSchema.parse({ item }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
