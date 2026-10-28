import { worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertSameOrigin,
  parseQueryValue,
  readCreateEmaInput,
  readIdempotencyKey,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { createEma } from "@/server/ema/repository";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = getServerRuntimeConfig();
    assertSameOrigin(request, config.appOrigin);
    requireWriteConfiguration();
    const authClient = await createSupabaseServerClient({
      responseHeaders: authHeaders,
    });
    const actor = await getVerifiedActor(authClient);
    if (!actor) {
      throw new ApiRouteError("AUTH_REQUIRED", "認証が必要です。");
    }

    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readCreateEmaInput(request);
    const result = await createEma(actor.uid, slug, input, idempotencyKey);

    return jsonResponse(
      { receipt: result.receipt },
      {
        status: 201,
        privacy: "private",
        headers: authHeaders,
      },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
