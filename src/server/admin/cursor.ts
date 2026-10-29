import "server-only";

import { z } from "zod";

import { utcIsoDateTimeSchema, uuidV4Schema } from "@/domain";
import { ApiRouteError } from "@/server/api/errors";
import { reportStateSchema, type ReportState } from "./contracts";

const cursorSchema = z
  .object({
    v: z.literal(1),
    state: reportStateSchema,
    createdAt: utcIsoDateTimeSchema,
    reportId: uuidV4Schema,
  })
  .strict();

export type AdminReportCursor = {
  createdAt: string;
  reportId: string;
};

export function encodeAdminReportCursor(
  state: ReportState,
  cursor: AdminReportCursor,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, state, ...cursor }),
    "utf8",
  ).toString("base64url");
}

export function decodeAdminReportCursor(
  value: string | null,
  state: ReportState,
): AdminReportCursor | null {
  if (value === null) return null;
  if (
    value.length === 0 ||
    value.length > 768 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorSchema.parse(JSON.parse(decoded));
    if (
      parsed.state !== state ||
      encodeAdminReportCursor(parsed.state, parsed) !== value
    ) {
      throw new Error("cursor context mismatch");
    }
    return { createdAt: parsed.createdAt, reportId: parsed.reportId };
  } catch {
    throw new ApiRouteError("INVALID_CURSOR", "ページ位置を確認してください。");
  }
}
