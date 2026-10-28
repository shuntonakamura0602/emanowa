import { publicIdSchema, worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import { parseQueryValue } from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getPublicEma } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug, id: rawId } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const publicId = parseQueryValue(publicIdSchema, rawId, "publicId");
    const ema = await getPublicEma(slug, publicId);
    if (!ema) {
      throw new ApiRouteError("NOT_FOUND", "絵馬が見つかりません。");
    }
    return jsonResponse({ ema });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
