import {
  categorySchema,
  publicEmaListResponseSchema,
  worldSlugSchema,
  type Category,
} from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertOnlyQueryKeys,
  assertSameOrigin,
  parseQueryValue,
  readCreateEmaInput,
  readIdempotencyKey,
  readSingleQueryParam,
} from "@/server/api/request";
import {
  decodePublicEmaCursor,
  encodePublicEmaCursor,
  publicFeedLimitQuerySchema,
} from "@/server/api/public-ema-cursor";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { createEma, listPublicEmas } from "@/server/ema/repository";
import { enforceActorRateLimit } from "@/server/rate-limit/enforce";
import { createSupabaseServerClient } from "@/server/supabase/server";

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
    assertOnlyQueryKeys(query, ["limit", "cursor", "category"]);
    const limit = parseQueryValue(
      publicFeedLimitQuerySchema,
      readSingleQueryParam(query, "limit") ?? "24",
      "limit",
    );
    const rawCategory = readSingleQueryParam(query, "category");
    const category: Category | null =
      rawCategory === null
        ? null
        : parseQueryValue(categorySchema, rawCategory, "category");
    const cursor = decodePublicEmaCursor(
      readSingleQueryParam(query, "cursor"),
      { worldSlug: slug, category },
    );
    const result = await listPublicEmas(slug, limit, category, cursor);
    if (!result) {
      throw new ApiRouteError("NOT_FOUND", "指定された年は見つかりません。");
    }
    return jsonResponse(
      publicEmaListResponseSchema.parse({
        items: result.items,
        nextCursor: result.next
          ? encodePublicEmaCursor({
              worldSlug: slug,
              category,
              order: "newest",
              ...result.next,
            })
          : null,
      }),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

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
    await enforceActorRateLimit("create", actor.uid);
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
