import type { Instrumentation } from "next";

function safeToken(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const token = value.slice(0, maximumLength);
  return /^[A-Za-z0-9_./:[\]-]+$/u.test(token) ? token : undefined;
}

/**
 * Records only routing metadata controlled by the application. Request URLs,
 * headers, cookies, error messages, and submitted content are deliberately
 * excluded because they can contain private or unlisted ema data.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const digest =
    error && typeof error === "object" && "digest" in error
      ? safeToken(error.digest, 128)
      : undefined;
  const method = safeToken(request.method.toUpperCase(), 16) ?? "UNKNOWN";
  const routePath = safeToken(context.routePath, 256) ?? "unknown";

  console.error(
    `[emanowa:server-error] ${JSON.stringify({
      method,
      routePath,
      routeType: context.routeType,
      ...(digest ? { digest } : {}),
    })}`,
  );
};
