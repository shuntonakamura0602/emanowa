import { publicIdSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertSameOrigin,
  parseQueryValue,
  readDeleteEmaInput,
  readIdempotencyKey,
  readUpdateEmaInput,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { deleteEma, updateEma } from "@/server/ema/repository";
import { enforceActorRateLimit } from "@/server/rate-limit/enforce";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actorAndId(
  params: Promise<{ id: string }>,
  authHeaders: Headers,
) {
  const authClient = await createSupabaseServerClient({
    responseHeaders: authHeaders,
  });
  const actor = await getVerifiedActor(authClient);
  if (!actor) throw new ApiRouteError("AUTH_REQUIRED", "認証が必要です。");
  const { id: rawId } = await params;
  return {
    actor,
    publicId: parseQueryValue(publicIdSchema, rawId, "publicId"),
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = getServerRuntimeConfig();
    assertSameOrigin(request, config.appOrigin);
    requireWriteConfiguration();
    const { actor, publicId } = await actorAndId(params, authHeaders);
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readUpdateEmaInput(request);
    await enforceActorRateLimit("edit", actor.uid);
    const result = await updateEma(actor.uid, publicId, input, idempotencyKey);
    return jsonResponse(
      { receipt: result.receipt },
      { privacy: "private", headers: authHeaders },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = getServerRuntimeConfig();
    assertSameOrigin(request, config.appOrigin);
    requireWriteConfiguration();
    const { actor, publicId } = await actorAndId(params, authHeaders);
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readDeleteEmaInput(request);
    const result = await deleteEma(actor.uid, publicId, input, idempotencyKey);
    return jsonResponse(
      { receipt: result.receipt },
      { privacy: "private", headers: authHeaders },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
