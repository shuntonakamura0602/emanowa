import { worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertSameOrigin,
  parseQueryValue,
  readIdempotencyKey,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { requireVerifiedAdminActorFromClient } from "@/server/admin/auth";
import {
  adminWorldPostingResponseSchema,
  setWorldPostingInputSchema,
} from "@/server/admin/contracts";
import { readAdminJsonInput } from "@/server/admin/request";
import {
  getAdminWorldPosting,
  setAdminWorldPosting,
} from "@/server/admin/repository";
import {
  getServerRuntimeConfig,
  type ServerRuntimeConfig,
} from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireAdminOperationConfiguration(): ServerRuntimeConfig {
  const config = getServerRuntimeConfig();
  if (
    !config.adminOperationsAvailable ||
    !config.appOrigin ||
    !config.supabase.configured ||
    !config.database.adminConfigured
  ) {
    throw new ApiRouteError(
      "TEMPORARILY_UNAVAILABLE",
      "管理操作に必要な設定が不足しています。",
    );
  }
  return config;
}

async function readWorldSlug(
  params: Promise<{ slug: string }>,
): Promise<string> {
  const { slug } = await params;
  return parseQueryValue(worldSlugSchema, slug, "worldSlug");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = requireAdminOperationConfiguration();
    const authClient = await createSupabaseServerClient({
      config,
      responseHeaders: authHeaders,
    });
    const admin = await requireVerifiedAdminActorFromClient(authClient);
    const worldSlug = await readWorldSlug(params);
    const world = await getAdminWorldPosting(admin.uid, worldSlug);
    if (!world) {
      throw new ApiRouteError("NOT_FOUND", "対象の年が見つかりません。");
    }
    return jsonResponse(adminWorldPostingResponseSchema.parse({ world }), {
      privacy: "private",
      headers: authHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = requireAdminOperationConfiguration();
    assertSameOrigin(request, config.appOrigin);
    const authClient = await createSupabaseServerClient({
      config,
      responseHeaders: authHeaders,
    });
    const admin = await requireVerifiedAdminActorFromClient(authClient);
    const worldSlug = await readWorldSlug(params);
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readAdminJsonInput(request, setWorldPostingInputSchema);
    const world = await setAdminWorldPosting(
      admin.uid,
      worldSlug,
      input,
      idempotencyKey,
    );
    return jsonResponse(adminWorldPostingResponseSchema.parse({ world }), {
      privacy: "private",
      headers: authHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
