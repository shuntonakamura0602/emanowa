"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { TurnstileChallenge } from "@/components/auth/turnstile-challenge";
import type { ApiError } from "@/domain/schemas";
import { countGraphemes } from "@/domain/text";

import { withAnonymousSessionLock } from "./anonymous-session-coordinator";
import {
  canonicalReportPayload,
  REPORT_REASON_OPTIONS,
  reportInputFromDraft,
  reportReceiptFromBody,
  reportRetryDelay,
  type ReportDraft,
  type ReportFieldErrors,
} from "./ema-report-contracts";
import { isApiError } from "./ui-contracts";

type PendingSubmission = { payload: string; key: string };

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function reportErrorMessage(error: ApiError["error"]): string {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return "送信できる状態を確認できませんでした。安全確認後にもう一度お試しください。";
    case "RATE_LIMITED":
      return "通報の送信回数が上限に達しました。少し時間をおいて、もう一度お試しください。";
    case "NOT_FOUND":
      return "この絵馬は削除されたか、現在は公開されていません。";
    case "IDEMPOTENCY_KEY_REUSED":
      return "送信内容が変わりました。内容を確認して、もう一度お試しください。";
    case "TEMPORARILY_UNAVAILABLE":
      return "現在は通報を受け付けられません。入力内容を残したまま、時間をおいて再試行してください。";
    default:
      return error.message;
  }
}

export function EmaReportPanel({
  worldSlug,
  publicId,
  captchaSiteKey,
  captchaRequired,
}: {
  worldSlug: string;
  publicId: string;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const detailRef = useRef<HTMLTextAreaElement>(null);
  const submissionRef = useRef<PendingSubmission | null>(null);
  const [draft, setDraft] = useState<ReportDraft>({ reason: "", detail: "" });
  const [fieldErrors, setFieldErrors] = useState<ReportFieldErrors>({});
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [statusTone, setStatusTone] = useState<"neutral" | "error">("neutral");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setRetrySeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  function openDialog(): void {
    setStatus("");
    setStatusTone("neutral");
    setFieldErrors({});
    setDialogOpen(true);
    dialogRef.current?.showModal();
  }

  function closeDialog(): void {
    if (!submitting) dialogRef.current?.close();
  }

  function pendingSubmission(payload: string): PendingSubmission {
    const current = submissionRef.current;
    if (current?.payload === payload) return current;
    const next = { payload, key: crypto.randomUUID() };
    submissionRef.current = next;
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || retrySeconds > 0 || submitted) return;

    const parsed = reportInputFromDraft(draft);
    if (!parsed.input) {
      setFieldErrors(parsed.fieldErrors);
      setStatus("入力内容を確認してください。");
      setStatusTone("error");
      requestAnimationFrame(() => {
        if (parsed.fieldErrors.reason) reasonRef.current?.focus();
        else if (parsed.fieldErrors.detail) detailRef.current?.focus();
      });
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setStatus("送信できる状態を確認しています。");
    setStatusTone("neutral");
    const submission = pendingSubmission(canonicalReportPayload(parsed.input));

    try {
      const result = await withAnonymousSessionLock(async () => {
        const authResponse = await fetch("/api/v1/auth/anonymous", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(captchaToken ? { captchaToken } : {}),
        });
        const authBody = await safeJson(authResponse);
        if (captchaToken) {
          setCaptchaToken(null);
          setCaptchaResetKey((current) => current + 1);
        }
        if (!authResponse.ok) {
          setSessionConfirmed(false);
          return { response: authResponse, body: authBody };
        }
        setSessionConfirmed(true);

        const response = await fetch(
          `/api/v1/worlds/${encodeURIComponent(worldSlug)}/emas/${encodeURIComponent(publicId)}/reports`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": submission.key,
            },
            body: submission.payload,
          },
        );
        return { response, body: await safeJson(response) };
      });

      if (!result.response.ok) {
        const errorBody = result.body;
        if (!isApiError(errorBody)) {
          setStatusTone("error");
          setStatus(
            "送信結果を確認できませんでした。入力内容を残したまま、もう一度お試しください。",
          );
          return;
        }
        setStatusTone("error");
        setStatus(reportErrorMessage(errorBody.error));
        if (
          errorBody.error.code === "AUTH_REQUIRED" ||
          errorBody.error.code === "SESSION_EXPIRED"
        ) {
          setSessionConfirmed(false);
        }
        if (errorBody.error.code === "RATE_LIMITED") {
          setRetrySeconds(
            reportRetryDelay(
              result.response.headers.get("Retry-After"),
              errorBody.error.retryAfterSeconds,
            ),
          );
        }
        if (errorBody.error.code === "IDEMPOTENCY_KEY_REUSED") {
          submissionRef.current = null;
        }
        const nextFields: ReportFieldErrors = {};
        for (const [field, message] of Object.entries(
          errorBody.error.fieldErrors ?? {},
        )) {
          if (
            field === "reason" ||
            field === "detail" ||
            field === "request" ||
            field === "idempotencyKey"
          ) {
            nextFields[field] = message;
          }
        }
        setFieldErrors(nextFields);
        return;
      }

      if (!reportReceiptFromBody(result.body)) {
        setStatus(
          "送信結果を確認できませんでした。同じ内容のまま、もう一度お試しください。",
        );
        return;
      }
      submissionRef.current = null;
      setSubmitted(true);
      setStatusTone("neutral");
      setDraft({ reason: "", detail: "" });
      setStatus(
        "通報を受け付けました。内容を確認しますが、対応結果を確約するものではありません。",
      );
    } catch {
      setStatusTone("error");
      setStatus(
        "送信結果を確認できませんでした。入力内容を残したまま、もう一度お試しください。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const detailCount = countGraphemes(draft.detail.normalize("NFC"));
  const statusIsError = statusTone === "error" && !submitted;

  return (
    <>
      <button
        className="button button--quiet"
        type="button"
        onClick={openDialog}
      >
        この絵馬を通報する
      </button>

      <dialog
        ref={dialogRef}
        className="share-dialog report-dialog"
        aria-labelledby="report-dialog-title"
        onClose={() => setDialogOpen(false)}
        onCancel={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <div className="share-dialog__header">
          <div>
            <p className="eyebrow">内容を運営へ知らせる</p>
            <h2 id="report-dialog-title">この絵馬を通報する</h2>
          </div>
          <button
            className="share-dialog__close"
            type="button"
            aria-label="通報画面を閉じる"
            disabled={submitting}
            onClick={closeDialog}
          >
            ×
          </button>
        </div>

        <div className="share-dialog__body">
          {submitted ? (
            <div className="status-stack" aria-live="polite">
              <p className="form-message form-message--success" role="status">
                {status}
              </p>
              <p>
                通報しただけで、この絵馬が自動的に非表示になることはありません。
              </p>
              <button className="button" type="button" onClick={closeDialog}>
                閉じる
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <p>
                問題に最も近い理由を選んでください。通報者の情報は公開されません。
              </p>
              <div className="field">
                <label htmlFor={`report-reason-${publicId}`}>通報理由</label>
                <select
                  ref={reasonRef}
                  id={`report-reason-${publicId}`}
                  value={draft.reason}
                  disabled={submitting}
                  aria-invalid={Boolean(fieldErrors.reason)}
                  aria-describedby={
                    fieldErrors.reason
                      ? `report-reason-error-${publicId}`
                      : undefined
                  }
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      reason: event.target.value as ReportDraft["reason"],
                    }));
                    submissionRef.current = null;
                  }}
                >
                  <option value="">理由を選んでください</option>
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.reason ? (
                  <p
                    id={`report-reason-error-${publicId}`}
                    className="form-message form-message--error"
                    role="alert"
                  >
                    {fieldErrors.reason}
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label htmlFor={`report-detail-${publicId}`}>
                  補足（任意）
                </label>
                <textarea
                  ref={detailRef}
                  id={`report-detail-${publicId}`}
                  value={draft.detail}
                  disabled={submitting}
                  maxLength={2_000}
                  aria-invalid={Boolean(fieldErrors.detail)}
                  aria-describedby={`report-detail-hint-${publicId}${fieldErrors.detail ? ` report-detail-error-${publicId}` : ""}`}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      detail: event.target.value,
                    }));
                    submissionRef.current = null;
                  }}
                />
                <p
                  id={`report-detail-hint-${publicId}`}
                  className="field__hint"
                >
                  個人情報を書かず、200文字以内で入力してください（{detailCount}
                  /200）。HTMLやMarkdownとしては扱いません。
                </p>
                {fieldErrors.detail ? (
                  <p
                    id={`report-detail-error-${publicId}`}
                    className="form-message form-message--error"
                    role="alert"
                  >
                    {fieldErrors.detail}
                  </p>
                ) : null}
              </div>

              {dialogOpen ? (
                <TurnstileChallenge
                  siteKey={captchaSiteKey}
                  required={captchaRequired && !sessionConfirmed}
                  action="anonymous-auth"
                  resetKey={captchaResetKey}
                  onTokenChange={setCaptchaToken}
                />
              ) : null}

              {status ? (
                <p
                  className={
                    statusIsError
                      ? "form-message form-message--error"
                      : "form-message"
                  }
                  role={statusIsError ? "alert" : "status"}
                  aria-live="polite"
                >
                  {status}
                </p>
              ) : null}
              {retrySeconds > 0 ? (
                <p className="field__hint" role="status">
                  再試行まで約{retrySeconds}秒です。
                </p>
              ) : null}

              <div className="action-row">
                <button
                  className="button button--danger"
                  type="submit"
                  disabled={submitting || retrySeconds > 0}
                >
                  {submitting ? "送信しています…" : "通報を送信する"}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={submitting}
                  onClick={closeDialog}
                >
                  キャンセル
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
