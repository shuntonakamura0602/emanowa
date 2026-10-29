import "server-only";

import { z } from "zod";

import { INPUT_LIMITS } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > INPUT_LIMITS.requestJsonBytes
    ) {
      throw new ApiRouteError(
        "VALIDATION_ERROR",
        "8KiB以内のJSONを送信してください。",
        { fieldErrors: { request: "8KiB以内で送信してください" } },
      );
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > INPUT_LIMITS.requestJsonBytes) {
      await reader.cancel();
      throw new ApiRouteError(
        "VALIDATION_ERROR",
        "8KiB以内のJSONを送信してください。",
        { fieldErrors: { request: "8KiB以内で送信してください" } },
      );
    }
    chunks.push(value);
  }

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readAdminJsonInput<T>(
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

  const bytes = await readBoundedBody(request);
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return schema.parse(JSON.parse(body));
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new ApiRouteError(
      "VALIDATION_ERROR",
      "JSONの形式を確認してください。",
      { fieldErrors: { request: "有効なJSONを指定してください" } },
    );
  }
}
