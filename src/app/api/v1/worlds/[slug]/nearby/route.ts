import { z } from "zod";

import {
  nearbyResponseSchema,
  publicIdSchema,
  worldSlugSchema,
} from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import {
  assertOnlyQueryKeys,
  parseQueryValue,
  readSingleQueryParam,
} from "@/server/api/request";
import { apiErrorResponse, jsonResponse } from "@/server/api/response";
import { getNearbySlots } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const coordinateQuerySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,2})$/u, "0〜999の整数で指定してください")
  .transform(Number);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug: rawSlug } = await params;
    const slug = parseQueryValue(worldSlugSchema, rawSlug, "worldSlug");
    const search = new URL(request.url).searchParams;
    assertOnlyQueryKeys(search, ["near", "x", "y"]);
    const rawNear = readSingleQueryParam(search, "near");
    const rawX = readSingleQueryParam(search, "x");
    const rawY = readSingleQueryParam(search, "y");

    const usesNear = rawNear !== null;
    const usesCoordinates = rawX !== null || rawY !== null;
    if (
      usesNear === usesCoordinates ||
      (usesCoordinates && (rawX === null || rawY === null))
    ) {
      throw new ApiRouteError(
        "INVALID_QUERY",
        "nearまたはx/yのどちらか一方を指定してください。",
        {
          fieldErrors: {
            request: "nearとx/yを同時に指定できません",
          },
        },
      );
    }

    const query = usesNear
      ? {
          near: parseQueryValue(publicIdSchema, rawNear, "near"),
        }
      : {
          x: parseQueryValue(coordinateQuerySchema, rawX, "x"),
          y: parseQueryValue(coordinateQuerySchema, rawY, "y"),
        };
    const result = await getNearbySlots(slug, query);
    if (!result) {
      throw new ApiRouteError(
        "NOT_FOUND",
        "招待された絵馬または指定された年が見つかりません。",
      );
    }
    return jsonResponse(nearbyResponseSchema.parse(result));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
