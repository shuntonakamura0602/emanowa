import { z } from "zod";

import { ApiRouteError } from "@/server/api/errors";
import {
  decodeOwnerWorldCursor,
  encodeOwnerWorldCursor,
} from "@/server/api/owner-worlds-cursor";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getVerifiedActor } from "@/server/auth/session";
import { listOwnerWorlds } from "@/server/ema/repository";
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
    const actor = await getVerifiedActor(authClient);
    if (!actor) throw new ApiRouteError("AUTH_REQUIRED", "認証が必要です。");

    const query = new URL(request.url).searchParams;
    const rawLimit = query.get("limit");
    const parsedLimit = limitSchema.safeParse(rawLimit ?? 12);
    if (!parsedLimit.success) {
      throw new ApiRouteError("INVALID_QUERY", "件数を確認してください。", {
        fieldErrors: { limit: "1〜50の整数で指定してください" },
      });
    }
    const cursor = decodeOwnerWorldCursor(query.get("cursor"));
    const result = await listOwnerWorlds(actor.uid, parsedLimit.data, cursor);
    return jsonResponse(
      {
        items: result.items,
        nextCursor: result.next ? encodeOwnerWorldCursor(result.next) : null,
      },
      { privacy: "private", headers: authHeaders },
    );
  } catch (error) {
    return apiErrorResponse(error, "private", authHeaders);
  }
}
