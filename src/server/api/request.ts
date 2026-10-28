import { z } from "zod";

import {
  INPUT_LIMITS,
  createEmaInputSchema,
  deleteEmaInputSchema,
  idempotencyKeySchema,
  updateEmaInputSchema,
  type CreateEmaInput,
  type DeleteEmaInput,
  type UpdateEmaInput,
} from "@/domain";
import { ApiRouteError } from "@/server/api/errors";

export function assertSameOrigin(
  request: Request,
  appOrigin: string | null,
): void {
  if (!appOrigin) {
    throw new ApiRouteError(
      "TEMPORARILY_UNAVAILABLE",
      "サーバー設定が不足しています。",
    );
  }

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ApiRouteError(
      "FORBIDDEN",
      "この送信元からの操作は許可されていません。",
    );
  }

  const requestOrigin = request.headers.get("origin");
  let matches = false;
  try {
    matches =
      Boolean(requestOrigin) &&
      new URL(requestOrigin as string).origin === new URL(appOrigin).origin;
  } catch {
    matches = false;
  }
  if (!matches) {
    throw new ApiRouteError(
      "FORBIDDEN",
      "この送信元からの操作は許可されていません。",
    );
  }
}

async function readBoundedRequestBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ApiRouteError(
        "VALIDATION_ERROR",
        "Content-Lengthが不正です。",
        { fieldErrors: { request: "有効な本文サイズを指定してください" } },
      );
    }
    if (parsedLength > INPUT_LIMITS.requestJsonBytes) {
      throw new ApiRouteError(
        "VALIDATION_ERROR",
        "リクエストが大きすぎます。",
        { fieldErrors: { request: "8KiB以内で送信してください" } },
      );
    }
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > INPUT_LIMITS.requestJsonBytes) {
      await reader.cancel();
      throw new ApiRouteError(
        "VALIDATION_ERROR",
        "リクエストが大きすぎます。",
        { fieldErrors: { request: "8KiB以内で送信してください" } },
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function readIdempotencyKey(request: Request): string {
  const parsed = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!parsed.success) {
    throw new ApiRouteError(
      "VALIDATION_ERROR",
      "Idempotency-KeyにUUID v4を指定してください。",
      { fieldErrors: { idempotencyKey: "UUID v4を指定してください" } },
    );
  }
  return parsed.data;
}

async function readJsonInput<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiRouteError(
      "VALIDATION_ERROR",
      "Content-Typeにapplication/jsonを指定してください。",
      { fieldErrors: { request: "JSON形式で送信してください" } },
    );
  }

  const bytes = await readBoundedRequestBody(request);
  let value: unknown;
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(body);
  } catch {
    throw new ApiRouteError(
      "VALIDATION_ERROR",
      "JSONの形式を確認してください。",
      { fieldErrors: { request: "有効なJSONを指定してください" } },
    );
  }
  return schema.parse(value);
}

export function readCreateEmaInput(request: Request): Promise<CreateEmaInput> {
  return readJsonInput(request, createEmaInputSchema);
}

export function readUpdateEmaInput(request: Request): Promise<UpdateEmaInput> {
  return readJsonInput(request, updateEmaInputSchema);
}

export function readDeleteEmaInput(request: Request): Promise<DeleteEmaInput> {
  return readJsonInput(request, deleteEmaInputSchema);
}

export function parseQueryValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  field: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiRouteError("INVALID_QUERY", "URLの指定を確認してください。", {
      fieldErrors: { [field]: parsed.error.issues[0]?.message ?? "無効です" },
    });
  }
  return parsed.data;
}

export function assertOnlyQueryKeys(
  query: URLSearchParams,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of query.keys()) {
    if (!allowed.has(key)) {
      throw new ApiRouteError(
        "INVALID_QUERY",
        "URLの指定を確認してください。",
        { fieldErrors: { [key]: "この項目は指定できません" } },
      );
    }
  }
}

export function readSingleQueryParam(
  query: URLSearchParams,
  key: string,
): string | null {
  const values = query.getAll(key);
  if (values.length > 1) {
    throw new ApiRouteError("INVALID_QUERY", "URLの指定を確認してください。", {
      fieldErrors: { [key]: "同じ項目を複数指定できません" },
    });
  }
  return values[0] ?? null;
}
