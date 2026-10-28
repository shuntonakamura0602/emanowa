import { z } from "zod";

import { INPUT_LIMITS, type ApiError, type ApiErrorCode } from "@/domain";
import type { EnvironmentName } from "@/server/config/parse";
import type { EmailAuthClient } from "@/server/supabase/contracts";

import {
  EmailAuthFlowError,
  linkAnonymousEmail,
  requestEmailRecovery,
  signOutLocal,
  verifyEmailOtp,
} from "./email";

const CAPTCHA_TOKEN_MAX_BYTES = 4 * 1_024;

const emailSchema = z
  .string()
  .trim()
  .min(1, "メールアドレスを入力してください。")
  .max(254, "メールアドレスが長すぎます。")
  .email("メールアドレスの形式を確認してください。");

const captchaTokenSchema = z
  .string()
  .trim()
  .min(1, "CAPTCHAトークンを指定してください。")
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <= CAPTCHA_TOKEN_MAX_BYTES,
    "CAPTCHAトークンが長すぎます。",
  );

const linkBodySchema = z.object({ email: emailSchema }).strict();
const recoverBodySchema = z
  .object({
    email: emailSchema,
    captchaToken: captchaTokenSchema.optional(),
  })
  .strict();
const verifyBodySchema = z
  .object({
    flow: z.enum(["link", "recover"]),
    email: emailSchema,
    token: z
      .string()
      .trim()
      .regex(/^\d{6}$/u, "6桁の確認コードを入力してください。"),
  })
  .strict();
const signOutBodySchema = z.object({}).strict();

export type EmailEndpointConfig = {
  environment: EnvironmentName;
  appOrigin: string | null;
  supabase: {
    configured: boolean;
  };
  captcha: {
    configured: boolean;
    required: boolean;
  };
};

export type EmailEndpointDependencies<
  Config extends EmailEndpointConfig = EmailEndpointConfig,
> = {
  getConfig(): Config;
  createClient(
    responseHeaders: Headers,
    config: Config,
  ): EmailAuthClient | Promise<EmailAuthClient>;
  createRequestId?(): string;
};

class RequestValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("入力内容を確認してください。");
    this.name = "RequestValidationError";
  }
}

function privateHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    Expires: "0",
    Pragma: "no-cache",
    Vary: "Origin, Cookie",
    "X-Content-Type-Options": "nosniff",
  });
}

function secureHeaders(headers: Headers, requestId: string): Headers {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Expires", "0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Origin, Cookie");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Request-ID", requestId);
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Headers,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: secureHeaders(headers, requestId),
  });
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  headers: Headers,
  requestId: string,
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
  return jsonResponse(body, status, headers, requestId);
}

function expectedOrigin(
  request: Request,
  config: EmailEndpointConfig,
): string | null {
  if (config.appOrigin) {
    try {
      return new URL(config.appOrigin).origin;
    } catch {
      return null;
    }
  }
  if (config.environment === "development" || config.environment === "test") {
    return new URL(request.url).origin;
  }
  return null;
}

function hasTrustedOrigin(request: Request, expected: string): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === expected && origin === expected;
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RequestValidationError({
        request: "Content-Lengthが不正です。",
      });
    }
    if (parsed > INPUT_LIMITS.requestJsonBytes) {
      throw new RequestValidationError({
        request: "8KiB以内で送信してください。",
      });
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
      throw new RequestValidationError({
        request: "8KiB以内で送信してください。",
      });
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

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys)
        fields[key] ??= "受け付けていない項目です。";
      continue;
    }
    const field = issue.path[0];
    const key = typeof field === "string" ? field : "request";
    fields[key] ??= issue.message;
  }
  return fields;
}

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new RequestValidationError({
      request: "JSON形式で送信してください。",
    });
  }

  const bytes = await readBoundedBody(request);
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new RequestValidationError({
      request: "有効なJSONを指定してください。",
    });
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new RequestValidationError(zodFieldErrors(parsed.error));
  return parsed.data;
}

type EndpointKind = "link" | "recover" | "verify" | "signout";

export function createEmailEndpointHandler<Config extends EmailEndpointConfig>(
  kind: EndpointKind,
  dependencies: EmailEndpointDependencies<Config>,
) {
  return async function POST(request: Request): Promise<Response> {
    const headers = privateHeaders();
    const requestId =
      dependencies.createRequestId?.() ?? globalThis.crypto.randomUUID();
    const config = dependencies.getConfig();
    const origin = expectedOrigin(request, config);

    if (!origin) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "送信元検証の設定が完了していません。",
        503,
        headers,
        requestId,
      );
    }
    if (!hasTrustedOrigin(request, origin)) {
      return errorResponse(
        "FORBIDDEN",
        "この送信元からのリクエストは受け付けられません。",
        403,
        headers,
        requestId,
      );
    }

    let body:
      | z.infer<typeof linkBodySchema>
      | z.infer<typeof recoverBodySchema>
      | z.infer<typeof verifyBodySchema>
      | z.infer<typeof signOutBodySchema>;
    try {
      if (kind === "link") body = await readJson(request, linkBodySchema);
      else if (kind === "recover")
        body = await readJson(request, recoverBodySchema);
      else if (kind === "verify")
        body = await readJson(request, verifyBodySchema);
      else body = await readJson(request, signOutBodySchema);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return errorResponse(
          "VALIDATION_ERROR",
          "入力内容を確認してください。",
          422,
          headers,
          requestId,
          error.fieldErrors,
        );
      }
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "認証リクエストを処理できませんでした。",
        503,
        headers,
        requestId,
      );
    }

    if (!config.supabase.configured) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "認証サービスの設定が完了していません。",
        503,
        headers,
        requestId,
      );
    }

    if (
      kind === "recover" &&
      config.captcha.required &&
      !config.captcha.configured
    ) {
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "CAPTCHAの設定が完了していません。",
        503,
        headers,
        requestId,
      );
    }

    if (
      kind === "recover" &&
      config.captcha.required &&
      !(body as z.infer<typeof recoverBodySchema>).captchaToken
    ) {
      return errorResponse(
        "VALIDATION_ERROR",
        "入力内容を確認してください。",
        422,
        headers,
        requestId,
        { captchaToken: "CAPTCHAトークンを指定してください。" },
      );
    }

    try {
      const client = await dependencies.createClient(headers, config);
      if (kind === "link") {
        await linkAnonymousEmail(
          client,
          (body as z.infer<typeof linkBodySchema>).email,
        );
        return jsonResponse({ accepted: true }, 202, headers, requestId);
      }
      if (kind === "recover") {
        const recover = body as z.infer<typeof recoverBodySchema>;
        await requestEmailRecovery(client, recover.email, recover.captchaToken);
        return jsonResponse({ accepted: true }, 202, headers, requestId);
      }
      if (kind === "verify") {
        await verifyEmailOtp(client, body as z.infer<typeof verifyBodySchema>);
        return jsonResponse(
          { authenticated: true, isAnonymous: false },
          200,
          headers,
          requestId,
        );
      }

      await signOutLocal(client);
      return jsonResponse({ signedOut: true }, 200, headers, requestId);
    } catch (error) {
      if (error instanceof EmailAuthFlowError) {
        if (error.authContextChanged) {
          headers.set("X-Emanowa-Auth-Context-Changed", "1");
        }
        return errorResponse(
          error.code,
          error.message,
          error.status,
          headers,
          requestId,
        );
      }
      if (kind === "verify") {
        headers.set("X-Emanowa-Auth-Context-Changed", "1");
      }
      return errorResponse(
        "TEMPORARILY_UNAVAILABLE",
        "認証サービスを利用できません。",
        503,
        headers,
        requestId,
      );
    }
  };
}
