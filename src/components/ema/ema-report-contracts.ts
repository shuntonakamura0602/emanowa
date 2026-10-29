import {
  createReportInputSchema,
  reportReceiptSchema,
  type CreateReportInput,
  type ReportReason,
  type ReportReceipt,
} from "@/domain/schemas";

export const REPORT_REASON_OPTIONS: readonly {
  value: ReportReason;
  label: string;
}[] = [
  { value: "spam", label: "宣伝・スパム" },
  { value: "harassment", label: "嫌がらせ" },
  { value: "personal_information", label: "個人情報" },
  { value: "sexual_content", label: "性的な内容" },
  { value: "illegal_content", label: "違法行為に関する内容" },
  { value: "other", label: "その他" },
];

export type ReportDraft = {
  reason: "" | ReportReason;
  detail: string;
};

export type ReportFieldErrors = Partial<
  Record<"reason" | "detail" | "request" | "idempotencyKey", string>
>;

export function reportInputFromDraft(draft: ReportDraft): {
  input: CreateReportInput | null;
  fieldErrors: ReportFieldErrors;
} {
  const parsed = createReportInputSchema.safeParse({
    reason: draft.reason,
    ...(draft.detail.trim() ? { detail: draft.detail } : {}),
  });
  if (parsed.success) return { input: parsed.data, fieldErrors: {} };

  const fieldErrors: ReportFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "reason" || field === "detail") {
      fieldErrors[field] ??= `${issue.message}。`;
    } else {
      fieldErrors.request ??= `${issue.message}。`;
    }
  }
  return { input: null, fieldErrors };
}

export function canonicalReportPayload(input: CreateReportInput): string {
  return JSON.stringify({
    reason: input.reason,
    ...(input.detail === undefined || input.detail === ""
      ? {}
      : { detail: input.detail }),
  });
}

export function reportReceiptFromBody(value: unknown): ReportReceipt | null {
  const parsed = reportReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function reportRetryDelay(
  retryAfterHeader: string | null,
  bodyDelay: number | undefined,
): number {
  if (typeof bodyDelay === "number" && Number.isFinite(bodyDelay)) {
    return Math.max(1, Math.min(3_600, Math.ceil(bodyDelay)));
  }
  if (retryAfterHeader && /^\d+$/u.test(retryAfterHeader)) {
    return Math.max(1, Math.min(3_600, Number(retryAfterHeader)));
  }
  return 60;
}
