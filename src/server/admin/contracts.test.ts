import { describe, expect, it } from "vitest";

import {
  adminReportSchema,
  moderationInputSchema,
  moderationReceiptSchema,
  updateReportInputSchema,
} from "./contracts";

const report = {
  reportId: "550e8400-e29b-41d4-a716-446655440000",
  reason: "personal_information",
  detail: "公開情報を確認してください",
  state: "open",
  version: 1,
  createdAt: "2026-10-29T00:00:00.000Z",
  resolvedAt: null,
  ema: {
    publicId: "660e8400-e29b-41d4-a716-446655440000",
    worldSlug: "2027",
    slotNumber: 1,
    status: "active",
    version: 2,
    nickname: null,
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
    messageText: "安全な公開本文",
  },
} as const;

describe("admin contracts", () => {
  it("accepts only the moderation and report state fields in the contract", () => {
    expect(
      moderationInputSchema.safeParse({
        action: "hide",
        reasonCode: "spam",
        expectedVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      moderationInputSchema.safeParse({
        action: "hide",
        reasonCode: "spam",
        expectedVersion: 1,
        ownerId: report.ema.publicId,
      }).success,
    ).toBe(false);
    expect(
      updateReportInputSchema.safeParse({
        state: "open",
        expectedVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("uses the canonical mutation receipt contract for moderation", () => {
    expect(
      moderationReceiptSchema.safeParse({
        publicId: report.ema.publicId,
        worldSlug: report.ema.worldSlug,
        version: 3,
        result: "updated",
        canonicalUrl: `/w/${report.ema.worldSlug}/e/${report.ema.publicId}`,
      }).success,
    ).toBe(true);
    expect(
      moderationReceiptSchema.safeParse({
        publicId: report.ema.publicId,
        worldSlug: report.ema.worldSlug,
        version: 3,
        result: "created",
        canonicalUrl: `/w/${report.ema.worldSlug}/e/${report.ema.publicId}`,
      }).success,
    ).toBe(false);
  });

  it("never accepts owner_only text in an admin list DTO", () => {
    expect(
      adminReportSchema.safeParse({
        ...report,
        ema: {
          ...report.ema,
          messageVisibility: "owner_only",
          messageText: "本人だけの秘密",
        },
      }).success,
    ).toBe(false);
  });

  it("never accepts stale text after moderation hides an ema", () => {
    expect(
      adminReportSchema.safeParse({
        ...report,
        ema: { ...report.ema, status: "hidden", messageText: "古い本文" },
      }).success,
    ).toBe(false);
    expect(
      adminReportSchema.safeParse({
        ...report,
        ema: { ...report.ema, status: "hidden", messageText: null },
      }).success,
    ).toBe(true);
  });
});
