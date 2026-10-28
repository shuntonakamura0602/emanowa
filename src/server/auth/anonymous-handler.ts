import { INPUT_LIMITS, type API_ERROR_CODE_VALUES } from "@/domain/constants";
import type { ApiError } from "@/domain/schemas";
import type { EnvironmentName } from "@/server/config/parse";
import type { AnonymousAuthClient } from "@/server/supabase/contracts";

import {
  AnonymousCaptchaRequiredError,
  AnonymousSignInError,
  ensureAnonymousSession,
  SessionVerificationError,
} from "./anonymous";

const CAPTCHA_TOKEN_MAX_BYTES = 4 * 1_024;

type ApiErrorCode = (typeof API_ERROR_CODE_VALUES)[number];

export type AnonymousEndpointConfig = {
  environment: EnvironmentName;
  appOrigin: string | null;
  supabase: {
    url: string | null;
    publishableKey: string | null;
    configured: boolean;
  };
  captcha: {
    configured: boolean;
    required: boolean;
  };
};

export type AnonymousEndpointDependencies<
  Config extends AnonymousEndpointConfig = AnonymousEndpointConfig,
> = {
  getConfig(): Config;
  createClient(
    responseHeaders: Headers,
    config: Config,
  ): AnonymousAuthClient | Promise<AnonymousAuthClient>;
  createRequestId?(): string;
};

type AnonymousRequestBody = {
  captchaToken?: string;
};

class RequestValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function responseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    Expires: "0",
    Pragma: "no-cache",
    Vary: "Origin, Cookie",
  });
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Headers,
): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
  headers: Headers,
  fieldErrors?: Record<string, string>,
): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
  return jsonResponse(body, status, headers);
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function expectedOrigin(
  request: Request,
  config: AnonymousEndpointConfig,
): string | null {
  if (config.appOrigin) return new URL(config.appOrigin).origin;
  if (config.environment === "development" || config.environment === "test") {
    return new URL(request.url).origin;
  }
  return null;
}

function hasTrustedOrigin(request: Request, expected: string): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === expected && origin === expected;
  } catch {
    return false;
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RequestValidationError("body", "Content-Lengthが不正です。");
    }
    if (parsed > INPUT_LIMITS.requestJsonBytes) {
      throw new RequestValidationError(
        "body",
        "リクエスト本文が上限を超えています。",
      );
    }
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > INPUT_LIMITS.requestJsonBytes) {
      await reader.cancel();
      throw new RequestValidationError(
        "body",
        "リクエスト本文が上限を超えています。",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function parseBody(request: Request): Promise<AnonymousRequestBody> {
  const bytes = await readBoundedBody(request);
  let parsed: unknown;

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new RequestValidationError("body", "JSON本文が不正です。");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestValidationError(
      "body",
      "JSONオブジェクトを指定してください。",
    );
  }

  const keys = Object.keys(parsed);
  const unknownKey = keys.find((key) => key !== "captchaToken");
  if (unknownKey) {
    throw new RequestValidationError(
      unknownKey,
      "受け付けていない項目が含まれています。",
    );
  }

  if (!("captchaToken" in parsed)) return {};
  const captchaToken = parsed.captchaToken;
  if (typeof captchaToken !== "string" || captchaToken.trim().length === 0) {
    throw new RequestValidationError(
      "captchaToken",
      "CAPTCHAトークンを指定してください。",
    );
  }
  if (
    new TextEncoder().encode(captchaToken).byteLength > CAPTCHA_TOKEN_MAX_BYTES
  ) {
    throw new RequestValidationError(
      "captchaToken",
      "CAPTCHAトークンが長すぎます。",
    );
  }

  return { captchaToken };
}

export function createAnonymousSessionHandler<
  Config extends AnonymousEndpointConfig,
>(dependencies: AnonymousEndpointDependencies<Config>) {
  return async function POST(request: Request): Promise<Response> {
    const headers = responseHeaders();
    const requestId =
      dependencies.createRequestId?.() ?? globalThis.crypto.randomUUID();
    const config = dependencies.getConfig();
    const origin = expectedOrigin(request, config);

    if (!origin) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "送信元検証の設定が完了していません。",
        503,
        requestId,
        headers,
      );
    }

    if (!hasTrustedOrigin(request, origin)) {
      return errorResponse(
        "FORBIDDEN",
        "この送信元からのリクエストは受け付けられません。",
        403,
        requestId,
        headers,
      );
    }

    if (!isJsonContentType(request.headers.get("content-type"))) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Content-Typeにapplication/jsonを指定してください。",
        422,
        requestId,
        headers,
        { body: "JSON本文を指定してください。" },
      );
    }

    let body: AnonymousRequestBody;
    try {
      body = await parseBody(request);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return errorResponse(
          "VALIDATION_ERROR",
          "入力内容を確認してください。",
          422,
          requestId,
          headers,
          { [error.field]: error.message },
        );
      }
      throw error;
    }

    if (!config.supabase.configured) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "認証サービスの設定が完了していません。",
        503,
        requestId,
        headers,
      );
    }

    if (config.captcha.required && !config.captcha.configured) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "CAPTCHAの設定が完了していません。",
        503,
        requestId,
        headers,
      );
    }

    try {
      const client = await dependencies.createClient(headers, config);
      const result = await ensureAnonymousSession(
        client,
        body.captchaToken,
        config.captcha.required,
      );

      return jsonResponse(
        {
          authenticated: true,
          isAnonymous: result.isAnonymous,
        },
        200,
        headers,
      );
    } catch (error) {
      if (error instanceof AnonymousCaptchaRequiredError) {
        return errorResponse(
          "VALIDATION_ERROR",
          "入力内容を確認してください。",
          422,
          requestId,
          headers,
          { captchaToken: "CAPTCHAトークンを指定してください。" },
        );
      }
      if (error instanceof SessionVerificationError) {
        return errorResponse(
          "SESSION_EXPIRED",
          "セッションを確認できませんでした。もう一度お試しください。",
          401,
          requestId,
          headers,
        );
      }
      if (error instanceof AnonymousSignInError) {
        if (error.status === 429) {
          return errorResponse(
            "RATE_LIMITED",
            "しばらく待ってからもう一度お試しください。",
            429,
            requestId,
            headers,
          );
        }
        return errorResponse(
          "TEMPORARILY_UNAVAILABLE",
          "匿名セッションを開始できませんでした。",
          503,
          requestId,
          headers,
        );
      }

      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "認証サービスを利用できません。",
        503,
        requestId,
        headers,
      );
    }
  };
}
