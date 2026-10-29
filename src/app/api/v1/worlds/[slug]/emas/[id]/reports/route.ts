import { publicIdSchema, worldSlugSchema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertSameOrigin,
  parseQueryValue,
  readIdempotencyKey,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import {
  getServerRuntimeConfig,
  requireWriteConfiguration,
} from "@/server/config";
import { enforceActorRateLimit } from "@/server/rate-limit/enforce";
import { submitReportCommand } from "@/server/reports/command";
import { readCreateReportInput } from "@/server/reports/input";
import { createReport } from "@/server/reports/repository";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ slug: string; id: string }>;
  },
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

    const { slug: rawSlug, id: rawId } = await params;
    const worldSlug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const publicId = parseQueryValue(publicIdSchema, rawId, "publicId");
    const idempotencyKey = readIdempotencyKey(request);
    const input = await readCreateReportInput(request);
    const result = await submitReportCommand(
      { actorId: actor.uid, worldSlug, publicId, input, idempotencyKey },
      {
        enforceRateLimit: (actorId) => enforceActorRateLimit("report", actorId),
        createReport,
      },
    );

    return jsonResponse(result.receipt, {
      status: result.httpStatus,
      privacy: "private",
      headers: authHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
