import { normalizeApiError } from "@/server/api/errors";

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
