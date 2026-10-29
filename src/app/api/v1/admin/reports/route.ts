import { z } from "zod";

import {
  assertOnlyQueryKeys,
  parseQueryValue,
  readSingleQueryParam,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { requireVerifiedAdminActorFromClient } from "@/server/admin/auth";
import {
  adminReportListResponseSchema,
  reportStateSchema,
} from "@/server/admin/contracts";
import {
  decodeAdminReportCursor,
  encodeAdminReportCursor,
} from "@/server/admin/cursor";
import { listAdminReports } from "@/server/admin/repository";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limitSchema = z.coerce.number().int().min(1).max(50);

export async function GET(request: Request): Promise<Response> {
  const authHeaders = new Headers();
  try {
    const authClient = await createSupabaseServerClient({
      responseHeaders: authHeaders,
    });
    const admin = await requireVerifiedAdminActorFromClient(authClient);
    const query = new URL(request.url).searchParams;
    assertOnlyQueryKeys(query, ["limit", "cursor", "state"]);
    const state = parseQueryValue(
      reportStateSchema,
      readSingleQueryParam(query, "state") ?? "open",
      "state",
    );
    const limit = parseQueryValue(
      limitSchema,
      readSingleQueryParam(query, "limit") ?? "50",
      "limit",
    );
    const cursor = decodeAdminReportCursor(
      readSingleQueryParam(query, "cursor"),
      state,
    );
    const result = await listAdminReports(admin.uid, state, limit, cursor);
    return jsonResponse(
      adminReportListResponseSchema.parse({
        items: result.items,
        nextCursor: result.next
          ? encodeAdminReportCursor(state, result.next)
          : null,
      }),
      { privacy: "private", headers: authHeaders },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
