import { z } from "zod";

import {
  categorySchema,
  designIdSchema,
  emaStatusSchema,
  messageVisibilitySchema,
  mutationReceiptSchema,
  nicknameSchema,
  publicIdSchema,
  reportDetailSchema,
  reportReasonSchema,
  safeDisplayTextSchema,
  slotNumberSchema,
  utcIsoDateTimeSchema,
  uuidV4Schema,
  versionSchema,
  visibilitySchema,
  wishTextSchema,
  worldSlugSchema,
} from "@/domain";

export const reportStateSchema = z.enum(["open", "resolved", "dismissed"]);
export const resolvedReportStateSchema = z.enum(["resolved", "dismissed"]);
export const moderationActionSchema = z.enum(["hide", "restore", "delete"]);

export const moderationInputSchema = z
  .object({
    action: moderationActionSchema,
    reasonCode: reportReasonSchema,
    expectedVersion: versionSchema,
  })
  .strict();

export const updateReportInputSchema = z
  .object({
    state: resolvedReportStateSchema,
    expectedVersion: versionSchema,
  })
  .strict();

export const adminReportTargetSchema = z
  .object({
    publicId: publicIdSchema,
    worldSlug: worldSlugSchema,
    slotNumber: slotNumberSchema,
    status: emaStatusSchema,
    version: versionSchema,
    nickname: nicknameSchema,
    category: categorySchema,
    designId: designIdSchema,
    visibility: visibilitySchema,
    messageVisibility: messageVisibilitySchema,
    messageText: wishTextSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.messageVisibility === "owner_only" &&
      value.messageText !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["messageText"],
        message: "本人だけの本文を管理一覧へ含めることはできません",
      });
    }
    if (value.status !== "active" && value.messageText !== null) {
      context.addIssue({
        code: "custom",
        path: ["messageText"],
        message: "非表示または削除済みの本文を管理一覧へ含めることはできません",
      });
    }
    if (
      value.status === "active" &&
      value.messageVisibility === "public" &&
      value.messageText === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["messageText"],
        message: "公開中の本文がありません",
      });
    }
  });

export const adminReportSchema = z
  .object({
    reportId: uuidV4Schema,
    reason: reportReasonSchema,
    detail: reportDetailSchema.nullable(),
    state: reportStateSchema,
    version: versionSchema,
    createdAt: utcIsoDateTimeSchema,
    resolvedAt: utcIsoDateTimeSchema.nullable(),
    ema: adminReportTargetSchema,
  })
  .strict();

export const adminReportListResponseSchema = z
  .object({
    items: z.array(adminReportSchema).max(50),
    nextCursor: safeDisplayTextSchema.pipe(z.string().max(768)).nullable(),
  })
  .strict();

export const moderationReceiptSchema = mutationReceiptSchema.superRefine(
  (value, context) => {
    if (value.result === "created") {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "管理操作は既存の絵馬だけを変更します",
      });
    }
  },
);

export const reportStateReceiptSchema = z
  .object({
    reportId: uuidV4Schema,
    state: resolvedReportStateSchema,
    version: versionSchema,
  })
  .strict();

export type ReportState = z.infer<typeof reportStateSchema>;
export type ModerationAction = z.infer<typeof moderationActionSchema>;
export type ModerationInput = z.infer<typeof moderationInputSchema>;
export type UpdateReportInput = z.infer<typeof updateReportInputSchema>;
export type AdminReport = z.infer<typeof adminReportSchema>;
export type AdminReportListResponse = z.infer<
  typeof adminReportListResponseSchema
>;
export type ModerationReceipt = z.infer<typeof moderationReceiptSchema>;
export type ReportStateReceipt = z.infer<typeof reportStateReceiptSchema>;
