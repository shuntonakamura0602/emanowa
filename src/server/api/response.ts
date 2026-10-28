import { ApiRouteError, normalizeApiError } from "@/server/api/errors";

type ResponsePrivacy = "public" | "private";

function responseHeaders(
  privacy: ResponsePrivacy,
  upstreamHeaders?: Headers,
): Headers {
  const headers = new Headers(upstreamHeaders);
  headers.set(
    "Cache-Control",
    privacy === "private" ? "private, no-store" : "no-store",
  );
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  if (privacy === "private") {
    const vary = new Set(
      (headers.get("Vary") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    vary.add("Cookie");
    headers.set("Vary", [...vary].join(", "));
  }
  return headers;
}

export function jsonResponse(
  body: unknown,
  options: {
    status?: number;
    privacy?: ResponsePrivacy;
    headers?: Headers;
  } = {},
): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: responseHeaders(options.privacy ?? "public", options.headers),
  });
}

/** Content-free aggregate statistics are the only P0 public JSON allowed in a
 * short shared cache. Individual, list, chunk, and owner responses stay
 * no-store through jsonResponse. */
export function publicOverviewJsonResponse(body: unknown): Response {
  const headers = responseHeaders("public");
  headers.set(
    "Cache-Control",
    "public, max-age=0, s-maxage=30, must-revalidate",
  );
  return Response.json(body, { status: 200, headers });
}

export function serializedJsonBytes(body: unknown): number {
  const serialized = JSON.stringify(body);
  if (serialized === undefined) {
    throw new ApiRouteError(
      "TEMPORARILY_UNAVAILABLE",
      "応答データを作成できませんでした。時間をおいて再試行してください。",
    );
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function boundedPublicJsonResponse(
  body: unknown,
  maxBytes: number,
): Response {
  const serialized = JSON.stringify(body);
  if (serialized === undefined) {
    throw new ApiRouteError(
      "TEMPORARILY_UNAVAILABLE",
      "応答データを作成できませんでした。時間をおいて再試行してください。",
    );
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new ApiRouteError(
      "TEMPORARILY_UNAVAILABLE",
      "地図データが大きいため、縮小表示へ戻して再試行してください。",
    );
  }
  return new Response(serialized, {
    status: 200,
    headers: responseHeaders("public"),
  });
}

export function apiErrorResponse(
  error: unknown,
  privacy: ResponsePrivacy = "public",
  upstreamHeaders?: Headers,
): Response {
  const normalized = normalizeApiError(error);
  if (normalized.status >= 500) {
    console.error(
      `[emanowa:api] request ${normalized.body.error.requestId} failed with ${normalized.body.error.code}`,
    );
  }
  const headers = responseHeaders(privacy, upstreamHeaders);
  headers.set("X-Request-ID", normalized.body.error.requestId);
  return Response.json(normalized.body, {
    status: normalized.status,
    headers,
  });
}
