import { worldSlugSchema } from "@/domain";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { ApiRouteError } from "@/server/api/errors";
import { parseQueryValue } from "@/server/api/request";
import { getPublicWorld } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const world = await getPublicWorld(slug);
    if (!world) {
      throw new ApiRouteError("NOT_FOUND", "指定された年は見つかりません。");
    }
    return jsonResponse(world);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
