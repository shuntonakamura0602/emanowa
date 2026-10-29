import { uuidV4Schema } from "@/domain";
import {
  assertSameOrigin,
  parseQueryValue,
  readIdempotencyKey,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { requireVerifiedAdminActorFromClient } from "@/server/admin/auth";
import { updateReportInputSchema } from "@/server/admin/contracts";
import { readAdminJsonInput } from "@/server/admin/request";
import { updateReportState } from "@/server/admin/repository";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
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
    const { reportId: rawReportId } = await params;
    const reportId = parseQueryValue(uuidV4Schema, rawReportId, "reportId");
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readAdminJsonInput(request, updateReportInputSchema);
    const receipt = await updateReportState(
      admin.uid,
      reportId,
      input,
      idempotencyKey,
    );
    return jsonResponse(receipt, {
      privacy: "private",
      headers: authHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
