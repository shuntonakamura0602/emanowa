import { worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import { parseQueryValue } from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import { getOwnerEma } from "@/server/ema/repository";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const authClient = await createSupabaseServerClient({
      responseHeaders: authHeaders,
    });
    const actor = await getVerifiedActor(authClient);
    if (!actor) {
      throw new ApiRouteError("AUTH_REQUIRED", "認証が必要です。");
    }

    const rawWorld = new URL(request.url).searchParams.get("world");
    const worldSlug = parseQueryValue(worldSlugSchema, rawWorld, "world");
    const ema = await getOwnerEma(actor.uid, worldSlug);
    return jsonResponse({ ema }, { privacy: "private", headers: authHeaders });
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
