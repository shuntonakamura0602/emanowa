import { describe, expect, it } from "vitest";

import {
  canonicalReportPayload,
  REPORT_REASON_OPTIONS,
  reportInputFromDraft,
  reportReceiptFromBody,
  reportRetryDelay,
} from "./ema-report-contracts";

const REPORT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("通報フォーム契約", () => {
  it("仕様で定義した6理由を日本語ラベル付きで提示する", () => {
    expect(REPORT_REASON_OPTIONS).toEqual([
      { value: "spam", label: "宣伝・スパム" },
      { value: "harassment", label: "嫌がらせ" },
      { value: "personal_information", label: "個人情報" },
      { value: "sexual_content", label: "性的な内容" },
      { value: "illegal_content", label: "違法行為に関する内容" },
      { value: "other", label: "その他" },
    ]);
  });

  it("理由を必須にし、補足はNFC・改行正規化して200書記素まで受け付ける", () => {
    expect(reportInputFromDraft({ reason: "", detail: "" }).input).toBeNull();

    const parsed = reportInputFromDraft({
      reason: "other",
      detail: `  か\u3099\r\n${"願".repeat(198)}  `,
    });
    expect(parsed.input?.detail).toBe(`が\n${"願".repeat(198)}`);
    expect(
      reportInputFromDraft({
        reason: "other",
        detail: "願".repeat(201),
      }).fieldErrors.detail,
    ).toContain("200文字以内");
  });

  it("空の補足をJSONへ含めず、同じ正規化入力を安定して直列化する", () => {
    expect(canonicalReportPayload({ reason: "spam" })).toBe(
      '{"reason":"spam"}',
    );
    expect(canonicalReportPayload({ reason: "spam", detail: "補足" })).toBe(
      '{"reason":"spam","detail":"補足"}',
    );
  });

  it("成功応答は公開可能な最小receiptだけを受理する", () => {
    expect(
      reportReceiptFromBody({ reportId: REPORT_ID, accepted: true }),
    ).toEqual({ reportId: REPORT_ID, accepted: true });
    expect(
      reportReceiptFromBody({
        reportId: REPORT_ID,
        accepted: true,
        reporterId: REPORT_ID,
      }),
    ).toBeNull();
  });

  it("Retry-Afterを安全な範囲へ丸め、本文値を優先する", () => {
    expect(reportRetryDelay("12", undefined)).toBe(12);
    expect(reportRetryDelay("12", 7.2)).toBe(8);
    expect(reportRetryDelay("99999", undefined)).toBe(3_600);
    expect(reportRetryDelay("invalid", undefined)).toBe(60);
  });
});
