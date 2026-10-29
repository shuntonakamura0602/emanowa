import { publicIdSchema } from "@/domain";
import {
  assertSameOrigin,
  parseQueryValue,
  readIdempotencyKey,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { requireVerifiedAdminActorFromClient } from "@/server/admin/auth";
import { moderationInputSchema } from "@/server/admin/contracts";
import { readAdminJsonInput } from "@/server/admin/request";
import { moderateEma } from "@/server/admin/repository";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const config = getServerRuntimeConfig();
    assertSameOrigin(request, config.appOrigin);
    requireWriteConfiguration();
    const authClient = await createSupabaseServerClient({
      responseHeaders: authHeaders,
    });
    const admin = await requireVerifiedAdminActorFromClient(authClient);
    const { id: rawPublicId } = await params;
    const publicId = parseQueryValue(publicIdSchema, rawPublicId, "publicId");
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readAdminJsonInput(request, moderationInputSchema);
    const receipt = await moderateEma(
      admin.uid,
      publicId,
      input,
      idempotencyKey,
    );
    return jsonResponse(
      { receipt },
      { privacy: "private", headers: authHeaders },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
