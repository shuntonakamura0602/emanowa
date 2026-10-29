import { createReportInputSchema, INPUT_LIMITS } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";

import type { CreateReportInput } from "@/domain";

async function readBoundedBody(request: Request): Promise<Uint8Array> {
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

export async function readCreateReportInput(
  request: Request,
): Promise<CreateReportInput> {
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

  const bytes = await readBoundedBody(request);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiRouteError(
      "VALIDATION_ERROR",
      "JSONの形式を確認してください。",
      { fieldErrors: { request: "有効なJSONを指定してください" } },
    );
  }
  return createReportInputSchema.parse(value);
}
