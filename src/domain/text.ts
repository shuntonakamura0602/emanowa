import { z } from "zod";

import { INPUT_LIMITS } from "./constants";

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const forbiddenControlPattern =
  /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const bidiControlPattern = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

export function normalizePlainText(value: string): string {
  return normalizeLineEndings(value).normalize("NFC");
}

export function normalizeWishText(value: string): string {
  return normalizePlainText(value).trim();
}

export function normalizeNickname(value: string): string | null {
  const normalized = normalizePlainText(value).trim();
  return normalized === "" ? null : normalized;
}

export function normalizeReportDetail(value: string): string {
  return normalizePlainText(value).trim();
}

export function countGraphemes(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function containsForbiddenControl(value: string): boolean {
  return forbiddenControlPattern.test(value);
}

export function containsBidiControl(value: string): boolean {
  return bidiControlPattern.test(value);
}

export function requestBodyByteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? utf8ByteLength(body) : body.byteLength;
}

export function isRequestBodyWithinLimit(body: string | Uint8Array): boolean {
  return requestBodyByteLength(body) <= INPUT_LIMITS.requestJsonBytes;
}

function addPlainTextIssues(
  value: string,
  context: z.RefinementCtx,
  options: {
    maxGraphemes: number;
    maxUtf8Bytes: number;
    maxLines?: number;
    singleLine?: boolean;
    requireContent?: boolean;
  },
): void {
  if (containsForbiddenControl(value)) {
    context.addIssue({
      code: "custom",
      message: "制御文字は使用できません",
    });
  }

  if (containsBidiControl(value)) {
    context.addIssue({
      code: "custom",
      message: "表示方向を変更する文字は使用できません",
    });
  }

  if (options.singleLine && value.includes("\n")) {
    context.addIssue({
      code: "custom",
      message: "改行は使用できません",
    });
  }

  if (
    options.maxLines !== undefined &&
    value.split("\n").length > options.maxLines
  ) {
    context.addIssue({
      code: "custom",
      message: `${options.maxLines}行以内で入力してください`,
    });
  }

  const graphemeCount = countGraphemes(value);
  if (options.requireContent && graphemeCount === 0) {
    context.addIssue({
      code: "custom",
      message: "入力してください",
    });
  }
  if (graphemeCount > options.maxGraphemes) {
    context.addIssue({
      code: "custom",
      message: `${options.maxGraphemes}文字以内で入力してください`,
    });
  }

  if (utf8ByteLength(value) > options.maxUtf8Bytes) {
    context.addIssue({
      code: "custom",
      message: "入力データが大きすぎます",
    });
  }
}

export const wishTextSchema = z
  .string()
  .transform(normalizeWishText)
  .superRefine((value, context) => {
    addPlainTextIssues(value, context, {
      maxGraphemes: INPUT_LIMITS.wishGraphemes,
      maxUtf8Bytes: INPUT_LIMITS.wishUtf8Bytes,
      maxLines: INPUT_LIMITS.wishLines,
      requireContent: true,
    });
  });

export const nicknameSchema = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : normalizeNickname(value)))
  .superRefine((value, context) => {
    if (value === null) {
      return;
    }
    addPlainTextIssues(value, context, {
      maxGraphemes: INPUT_LIMITS.nicknameGraphemes,
      maxUtf8Bytes: INPUT_LIMITS.nicknameUtf8Bytes,
      singleLine: true,
    });
  });

export const reportDetailSchema = z
  .string()
  .transform(normalizeReportDetail)
  .superRefine((value, context) => {
    addPlainTextIssues(value, context, {
      maxGraphemes: INPUT_LIMITS.reportDetailGraphemes,
      maxUtf8Bytes: INPUT_LIMITS.reportDetailUtf8Bytes,
    });
  });

export const safeDisplayTextSchema = z
  .string()
  .superRefine((value, context) => {
    if (containsForbiddenControl(value) || containsBidiControl(value)) {
      context.addIssue({
        code: "custom",
        message: "安全に表示できない文字が含まれています",
      });
    }
  });
