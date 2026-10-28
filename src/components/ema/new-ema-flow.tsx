"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ApiErrorCode, CreateEmaInput } from "@/domain/schemas";
import { countGraphemes } from "@/domain/text";

import { TurnstileChallenge } from "../auth/turnstile-challenge";
import {
  AnonymousSessionCoordinationError,
  withAnonymousSessionLock,
} from "./anonymous-session-coordinator";
import {
  forceCommitPendingAuthContextChange,
  readAuthContextEpoch,
  readAuthContextSnapshot,
  subscribeToAuthContextChanges,
} from "./auth-context-events";
import {
  EmaPreview,
  PreviewSurfaceTabs,
  type PreviewSurface,
} from "./ema-preview";
import {
  CATEGORY_OPTIONS,
  EMPTY_DRAFT,
  applyInitialSlotNumber,
  canonicalCreatePayload,
  createInputFromDraft,
  draftStorageKey,
  isApiError,
  isMutationReceipt,
  messageForApiError,
  nearbySlotCandidates,
  readStoredDraftForAuthContext,
  removeStoredDraft,
  writeStoredDraft,
  type EmaDraft,
  type FieldErrors,
  type StoredEmaDraft,
} from "./ui-contracts";

type Step = "write" | "confirm" | "success";
type SubmitState = "idle" | "saving" | "error" | "unknown";
type AuthState = "idle" | "checking" | "ready" | "error";

function emptyStoredDraft(
  authContextEpoch: string | null,
  initialSlotNumber: number | null = null,
): StoredEmaDraft {
  return {
    version: 2,
    authContextEpoch,
    values:
      initialSlotNumber === null
        ? EMPTY_DRAFT
        : { ...EMPTY_DRAFT, slotNumber: String(initialSlotNumber) },
    idempotencyKey: null,
    idempotencyPayload: null,
  };
}

function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function retryDelayFromResponse(
  response: Response,
  bodyDelay?: number,
): number {
  if (bodyDelay !== undefined) return bodyDelay;
  const headerDelay = Number(response.headers.get("Retry-After"));
  return Number.isFinite(headerDelay) ? Math.max(0, headerDelay) : 0;
}

export function NewEmaFlow({
  worldSlug,
  captchaSiteKey,
  captchaRequired,
  initialSlotNumber = null,
}: {
  worldSlug: string;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
  initialSlotNumber?: number | null;
}) {
  const [draft, setDraft] = useState<EmaDraft>(() =>
    initialSlotNumber === null
      ? EMPTY_DRAFT
      : { ...EMPTY_DRAFT, slotNumber: String(initialSlotNumber) },
  );
  const [stored, setStored] = useState<StoredEmaDraft>(() =>
    emptyStoredDraft(null, initialSlotNumber),
  );
  const [draftReady, setDraftReady] = useState(false);
  const [step, setStep] = useState<Step>("write");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [lastErrorCode, setLastErrorCode] = useState<ApiErrorCode | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [nearbyCandidates, setNearbyCandidates] = useState<number[]>([]);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>("map");
  const [receipt, setReceipt] = useState<{ publicId: string } | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [authTransitionPending, setAuthTransitionPending] = useState(false);

  const authPromiseRef = useRef<Promise<boolean> | null>(null);
  const authContextGenerationRef = useRef(0);
  const authContextEpochRef = useRef<string | null>(null);
  const hasStartedInputRef = useRef(false);
  const composingRef = useRef(false);
  const wishRef = useRef<HTMLTextAreaElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const completionRef = useRef<HTMLElement>(null);

  const storageKey = draftStorageKey(worldSlug);
  const wishCount = countGraphemes(draft.wishText);
  const nicknameCount = countGraphemes(draft.nickname);
  const slotNumber = Number(draft.slotNumber);
  const validSlotNumber = Number.isInteger(slotNumber) ? slotNumber : null;
  const inputsLocked = submitState === "saving" || submitState === "unknown";

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const snapshot = readAuthContextSnapshot();
      const authContextEpoch = snapshot.epoch;
      authContextEpochRef.current = authContextEpoch;
      if (snapshot.phase === "pending") {
        setAuthTransitionPending(true);
        return;
      }
      const restored = readStoredDraftForAuthContext(
        sessionStorage,
        storageKey,
        authContextEpoch,
      );
      if (restored) {
        const located = applyInitialSlotNumber(restored, initialSlotNumber);
        setDraft(located.values);
        setStored(located);
      } else {
        removeStoredDraft(sessionStorage, storageKey);
        const initial = emptyStoredDraft(authContextEpoch, initialSlotNumber);
        setDraft(initial.values);
        setStored(initial);
      }
      setDraftReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSlotNumber, storageKey]);

  useEffect(
    () =>
      subscribeToAuthContextChanges((change) => {
        authContextGenerationRef.current += 1;
        authPromiseRef.current = null;
        setSubmitState("idle");
        setAuthState("idle");
        setCaptchaToken(null);
        setCaptchaResetKey((current) => current + 1);

        if (change.phase === "pending") {
          setAuthTransitionPending(true);
          return;
        }

        authContextEpochRef.current = change.epoch;
        setAuthTransitionPending(false);
        setDraftReady(true);
        if (change.phase === "cancelled") {
          const restored = readStoredDraftForAuthContext(
            sessionStorage,
            storageKey,
            change.epoch,
          );
          if (restored) {
            const located = applyInitialSlotNumber(restored, initialSlotNumber);
            setDraft(located.values);
            setStored(located);
          }
          setGlobalMessage(
            "別のタブの本人情報変更は完了しませんでした。下書きを保持しています。",
          );
          return;
        }

        setDraft(EMPTY_DRAFT);
        setStored(emptyStoredDraft(change.epoch));
        setStep("write");
        setFieldErrors({});
        setLastErrorCode(null);
        setRetrySeconds(0);
        setNearbyCandidates([]);
        setReceipt(null);
        setGlobalMessage(
          "別のタブで本人情報が変更されたため、このタブの下書きを消去しました。",
        );
        removeStoredDraft(sessionStorage, storageKey);
      }),
    [initialSlotNumber, storageKey],
  );

  useEffect(() => {
    if (!draftReady || authTransitionPending || step === "success") return;
    const next: StoredEmaDraft = {
      version: 2,
      authContextEpoch: authContextEpochRef.current,
      values: draft,
      idempotencyKey: stored.idempotencyKey,
      idempotencyPayload: stored.idempotencyPayload,
    };
    writeStoredDraft(sessionStorage, storageKey, next);
  }, [
    draft,
    draftReady,
    authTransitionPending,
    step,
    storageKey,
    stored.idempotencyKey,
    stored.idempotencyPayload,
  ]);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  let previewCopy = "願いの本文と表示名が、選んだ掲載範囲で表示されます。";
  if (previewSurface === "map" && draft.visibility === "unlisted") {
    previewCopy =
      "リンク限定の絵馬は、地図では内容や表示名を出さず、使用中の場所として表示します。";
  } else if (draft.messageVisibility === "owner_only") {
    previewCopy =
      "願いの原文は公開せず、「ひみつの願い」と表示します。表示名は公開されます。";
  }

  function focusFirstError(errors: FieldErrors): void {
    const order: (keyof EmaDraft)[] = [
      "wishText",
      "nickname",
      "category",
      "slotNumber",
      "visibility",
      "messageVisibility",
    ];
    const first = order.find((field) => errors[field]);
    requestAnimationFrame(() => {
      if (first === "wishText") wishRef.current?.focus();
      else if (first === "nickname") nicknameRef.current?.focus();
      else if (first === "category") categoryRef.current?.focus();
      else if (first === "slotNumber") slotRef.current?.focus();
      else if (first) {
        document.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      }
    });
  }

  function handleCaptchaTokenChange(token: string | null): void {
    setCaptchaToken(token);
    if (
      token &&
      hasStartedInputRef.current &&
      (authState === "idle" || authState === "error")
    ) {
      void ensureAnonymousSession(token);
    }
  }

  function updateDraft<K extends keyof EmaDraft>(
    field: K,
    value: EmaDraft[K],
  ): void {
    if (inputsLocked) return;
    hasStartedInputRef.current = true;
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setLastErrorCode(null);
    setGlobalMessage(null);
    setNearbyCandidates([]);
    if (submitState === "error") setSubmitState("idle");
    if (
      (authState === "idle" || authState === "error") &&
      (!captchaRequired || captchaToken)
    ) {
      void ensureAnonymousSession(captchaToken);
    }
  }

  async function requestAnonymousSession(
    challengeToken: string | null,
    options: { forceCheck?: boolean; lockHeld?: boolean } = {},
  ): Promise<boolean> {
    if (!options.forceCheck && authState === "ready") return true;
    if (!options.forceCheck && authPromiseRef.current) {
      return authPromiseRef.current;
    }
    if (!options.forceCheck && captchaRequired && !challengeToken) {
      setAuthState("error");
      setGlobalMessage("安全確認を完了してから、もう一度お試しください。");
      return false;
    }

    setAuthState("checking");
    const authContextGeneration = authContextGenerationRef.current;
    const promise = (async () => {
      try {
        const send = () => {
          if (
            authContextGeneration !== authContextGenerationRef.current ||
            readAuthContextEpoch() !== authContextEpochRef.current
          ) {
            throw new AnonymousSessionCoordinationError(
              "別のタブで本人情報が変更されました。",
            );
          }
          return fetch("/api/v1/auth/anonymous", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              challengeToken ? { captchaToken: challengeToken } : {},
            ),
          });
        };
        const response = options.lockHeld
          ? await send()
          : await withAnonymousSessionLock(send);
        const body = await safeJson(response);
        if (authContextGeneration !== authContextGenerationRef.current) {
          return false;
        }
        if (!response.ok) {
          const message = isApiError(body)
            ? messageForApiError(body.error)
            : "編集できる状態を確認できませんでした。もう一度お試しください。";
          if (isApiError(body) && body.error.code === "RATE_LIMITED") {
            setRetrySeconds(
              retryDelayFromResponse(response, body.error.retryAfterSeconds),
            );
          }
          setAuthState("error");
          setGlobalMessage(message);
          return false;
        }
        setAuthState("ready");
        return true;
      } catch {
        setAuthState("error");
        setGlobalMessage(
          "編集できる状態を確認できませんでした。入力内容はこのタブに残っています。",
        );
        return false;
      } finally {
        authPromiseRef.current = null;
        if (captchaRequired && challengeToken) {
          setCaptchaToken(null);
          setCaptchaResetKey((current) => current + 1);
        }
      }
    })();
    authPromiseRef.current = promise;
    return promise;
  }

  function ensureAnonymousSession(
    challengeToken: string | null = captchaToken,
  ): Promise<boolean> {
    return requestAnonymousSession(challengeToken);
  }

  function handlePreview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) {
      return;
    }
    const parsed = createInputFromDraft(draft);
    if (!parsed.input) {
      setFieldErrors(parsed.fieldErrors);
      setGlobalMessage("入力内容を確認してください。");
      focusFirstError(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    setLastErrorCode(null);
    setGlobalMessage(null);
    setStep("confirm");
    requestAnimationFrame(() => confirmationRef.current?.focus());
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function persistSubmission(input: CreateEmaInput): {
    key: string;
    payload: string;
  } {
    const payload = canonicalCreatePayload(input);
    const key =
      stored.idempotencyKey && stored.idempotencyPayload === payload
        ? stored.idempotencyKey
        : crypto.randomUUID();
    const next: StoredEmaDraft = {
      version: 2,
      authContextEpoch: authContextEpochRef.current,
      values: draft,
      idempotencyKey: key,
      idempotencyPayload: payload,
    };
    setStored(next);
    writeStoredDraft(sessionStorage, storageKey, next);
    return { key, payload };
  }

  async function commitEma(): Promise<void> {
    if (retrySeconds > 0) return;
    hasStartedInputRef.current = true;
    const parsed = createInputFromDraft(draft);
    if (!parsed.input) {
      setStep("write");
      setFieldErrors(parsed.fieldErrors);
      focusFirstError(parsed.fieldErrors);
      return;
    }

    setSubmitState("saving");
    setGlobalMessage(null);
    setLastErrorCode(null);
    const submission = persistSubmission(parsed.input);
    const authContextGeneration = authContextGenerationRef.current;
    const authContextEpoch = authContextEpochRef.current;
    const authContextIsCurrent = (): boolean => {
      const snapshot = readAuthContextSnapshot();
      return (
        authContextGeneration === authContextGenerationRef.current &&
        snapshot.phase !== "pending" &&
        snapshot.epoch === authContextEpoch
      );
    };
    try {
      const result = await withAnonymousSessionLock(async () => {
        if (!authContextIsCurrent()) {
          throw new AnonymousSessionCoordinationError(
            "別のタブで本人情報が変更されました。",
          );
        }
        const authenticated = await requestAnonymousSession(captchaToken, {
          forceCheck: true,
          lockHeld: true,
        });
        if (!authenticated) return null;
        if (!authContextIsCurrent()) {
          throw new AnonymousSessionCoordinationError(
            "別のタブで本人情報が変更されました。",
          );
        }
        const response = await fetch(
          `/api/v1/worlds/${encodeURIComponent(worldSlug)}/emas`,
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
        const body = await safeJson(response);
        if (!authContextIsCurrent()) {
          throw new AnonymousSessionCoordinationError(
            "別のタブで本人情報が変更されました。",
          );
        }
        return { response, body };
      });
      if (!result || !authContextIsCurrent()) {
        setSubmitState("error");
        return;
      }
      const { response, body } = result;
      if (!response.ok) {
        setSubmitState("error");
        if (!isApiError(body)) {
          setGlobalMessage(
            "送信結果を確認できませんでした。入力内容を残したまま、もう一度お試しください。",
          );
          return;
        }

        setGlobalMessage(messageForApiError(body.error));
        setLastErrorCode(body.error.code);
        if (body.error.code === "RATE_LIMITED") {
          setRetrySeconds(
            retryDelayFromResponse(response, body.error.retryAfterSeconds),
          );
        }
        const apiFields = body.error.fieldErrors ?? {};
        const nextFieldErrors: FieldErrors = {};
        for (const [key, message] of Object.entries(apiFields)) {
          if (key === "x" || key === "y") nextFieldErrors.slotNumber = message;
          else if (
            key === "wishText" ||
            key === "nickname" ||
            key === "category" ||
            key === "visibility" ||
            key === "messageVisibility" ||
            key === "idempotencyKey" ||
            key === "request"
          ) {
            nextFieldErrors[key] = message;
          }
        }
        setFieldErrors(nextFieldErrors);

        if (body.error.code === "SLOT_TAKEN") {
          setNearbyCandidates(
            nearbySlotCandidates(parsed.input.y * 1_000 + parsed.input.x + 1),
          );
          setStep("write");
          focusFirstError({ slotNumber: messageForApiError(body.error) });
        } else if (
          body.error.code === "SESSION_EXPIRED" ||
          body.error.code === "AUTH_REQUIRED"
        ) {
          setAuthState("error");
        } else if (body.error.code === "VALIDATION_ERROR") {
          setStep("write");
          focusFirstError(nextFieldErrors);
        } else if (body.error.code === "IDEMPOTENCY_KEY_REUSED") {
          const reset = {
            ...stored,
            values: draft,
            idempotencyKey: null,
            idempotencyPayload: null,
          };
          setStored(reset);
          writeStoredDraft(sessionStorage, storageKey, reset);
        }
        return;
      }

      const candidate =
        body && typeof body === "object" && "receipt" in body
          ? (body as { receipt: unknown }).receipt
          : null;
      if (!isMutationReceipt(candidate) || candidate.worldSlug !== worldSlug) {
        setSubmitState("unknown");
        setGlobalMessage(
          "送信結果を確認できませんでした。同じ内容で結果を確認してください。",
        );
        return;
      }

      if (!authContextIsCurrent()) return;

      setReceipt({ publicId: candidate.publicId });
      setSubmitState("idle");
      setStep("success");
      removeStoredDraft(sessionStorage, storageKey);
      requestAnimationFrame(() => completionRef.current?.focus());
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch (error) {
      if (!authContextIsCurrent()) return;
      if (error instanceof AnonymousSessionCoordinationError) {
        setSubmitState("error");
        setStep("write");
        setGlobalMessage(
          "本人情報を安全に確認できませんでした。入力内容を確認して、もう一度お試しください。",
        );
        return;
      }
      setSubmitState("unknown");
      setGlobalMessage(
        "送信結果を確認できませんでした。同じ内容・同じ送信番号で結果を確認します。",
      );
    }
  }

  function discardDraft(): void {
    if (
      !window.confirm(
        "下書きを破棄しますか。入力した内容は元に戻すことができません。",
      )
    ) {
      return;
    }
    setDraft(EMPTY_DRAFT);
    const empty: StoredEmaDraft = {
      version: 2,
      authContextEpoch: authContextEpochRef.current,
      values: EMPTY_DRAFT,
      idempotencyKey: null,
      idempotencyPayload: null,
    };
    setStored(empty);
    setFieldErrors({});
    setGlobalMessage(null);
    setLastErrorCode(null);
    setNearbyCandidates([]);
    setSubmitState("idle");
    setStep("write");
    removeStoredDraft(sessionStorage, storageKey);
    wishRef.current?.focus();
  }

  if (authTransitionPending) {
    return (
      <section
        className="stage-card stage-card--private owner-loading"
        aria-live="polite"
        aria-busy="true"
      >
        <h2>本人情報を確認しています</h2>
        <p>
          別のタブの操作が完了するまで、下書きを安全のため一時的に隠しています。
        </p>
        <button
          className="button button--danger"
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "操作が中断された場合の復旧を続けますか。現在の下書きは安全のため破棄され、元に戻せません。",
              )
            ) {
              return;
            }
            const committed = forceCommitPendingAuthContextChange();
            if (!committed) return;
            authContextGenerationRef.current += 1;
            authContextEpochRef.current = committed.epoch;
            setDraft(EMPTY_DRAFT);
            setStored(emptyStoredDraft(committed.epoch));
            setDraftReady(true);
            setAuthTransitionPending(false);
            setStep("write");
            setReceipt(null);
            setGlobalMessage(
              "中断された本人情報変更から復旧し、以前の下書きを破棄しました。",
            );
            removeStoredDraft(sessionStorage, storageKey);
          }}
        >
          中断した操作から安全に復旧する
        </button>
      </section>
    );
  }

  if (step === "success" && receipt) {
    return (
      <section
        ref={completionRef}
        className="stage-card stage-card--private completion-card"
        aria-labelledby="completion-title"
        tabIndex={-1}
      >
        <p className="eyebrow">保存が完了しました</p>
        <h2 id="completion-title">願いを掛けました</h2>
        <EmaPreview
          wishText={draft.wishText}
          nickname={draft.nickname}
          category={draft.category}
          visibility={draft.visibility}
          messageVisibility={draft.messageVisibility}
          surface="link"
          slotNumber={validSlotNumber}
        />
        <dl className="confirmation-list">
          <div>
            <dt>年</dt>
            <dd>{worldSlug}年</dd>
          </div>
          <div>
            <dt>場所</dt>
            <dd>{validSlotNumber?.toLocaleString("ja-JP")}番</dd>
          </div>
        </dl>
        <p>
          この端末から編集できます。別の端末でも使う場合は、メールで引き継ぎを設定できます。
        </p>
        <p className="fine-print">
          ゲスト利用では、ブラウザーのデータを削除すると編集できなくなる場合があります。
        </p>
        <div className="action-row">
          <Link
            className="button"
            href={`/w/${encodeURIComponent(worldSlug)}/e/${receipt.publicId}`}
          >
            保存した絵馬を見る
          </Link>
          <Link className="button button--secondary" href="/me">
            自分の絵馬を見る
          </Link>
          <Link className="button button--quiet" href="/me#email-link">
            メールで引き継ぐ
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="ema-flow">
      <ol className="step-list" aria-label="絵馬を掛ける手順">
        <li aria-current={step === "write" ? "step" : undefined}>1. 入力</li>
        <li aria-current={step === "confirm" ? "step" : undefined}>2. 確認</li>
        <li>3. 完了</li>
      </ol>

      <div className="form-layout">
        {step === "write" ? (
          <form
            className="form-card"
            onSubmit={handlePreview}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) {
                event.preventDefault();
              }
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            noValidate
          >
            <div className="field">
              <label htmlFor="wishText">叶えたいことを書いてください</label>
              <textarea
                ref={wishRef}
                id="wishText"
                name="wishText"
                rows={4}
                value={draft.wishText}
                disabled={inputsLocked}
                aria-invalid={Boolean(fieldErrors.wishText)}
                aria-describedby="wish-hint wish-count wish-error"
                onChange={(event) =>
                  updateDraft("wishText", event.target.value)
                }
              />
              <div className="field__meta">
                <p className="field__hint" id="wish-hint">
                  80文字・4行以内。絵文字も見た目の1文字として数えます。
                </p>
                <p
                  className={
                    wishCount > 80
                      ? "character-count character-count--over"
                      : "character-count"
                  }
                  id="wish-count"
                >
                  {wishCount}/80文字
                </p>
              </div>
              <p className="field__error" id="wish-error">
                {fieldErrors.wishText}
              </p>
            </div>

            <div className="field">
              <label htmlFor="nickname">表示名（任意）</label>
              <input
                ref={nicknameRef}
                id="nickname"
                name="nickname"
                value={draft.nickname}
                disabled={inputsLocked}
                autoComplete="nickname"
                aria-invalid={Boolean(fieldErrors.nickname)}
                aria-describedby="nickname-hint nickname-count nickname-error"
                onChange={(event) =>
                  updateDraft("nickname", event.target.value)
                }
              />
              <div className="field__meta">
                <p className="field__hint" id="nickname-hint">
                  公開情報です。願いをひみつにしても表示されます。未入力時は「ななしさん」です。
                </p>
                <p
                  className={
                    nicknameCount > 20
                      ? "character-count character-count--over"
                      : "character-count"
                  }
                  id="nickname-count"
                >
                  {nicknameCount}/20文字
                </p>
              </div>
              <p className="field__error" id="nickname-error">
                {fieldErrors.nickname}
              </p>
            </div>

            <div className="field">
              <label htmlFor="category">願いの種類</label>
              <select
                ref={categoryRef}
                id="category"
                name="category"
                value={draft.category}
                disabled={inputsLocked}
                aria-invalid={Boolean(fieldErrors.category)}
                aria-describedby="category-error"
                onChange={(event) =>
                  updateDraft(
                    "category",
                    event.target.value as EmaDraft["category"],
                  )
                }
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="field__error" id="category-error">
                {fieldErrors.category}
              </p>
            </div>

            <div className="field">
              <label htmlFor="slotNumber">場所の番号</label>
              <input
                ref={slotRef}
                id="slotNumber"
                name="slotNumber"
                type="number"
                inputMode="numeric"
                min={1}
                max={1_000_000}
                step={1}
                value={draft.slotNumber}
                disabled={inputsLocked}
                aria-invalid={Boolean(fieldErrors.slotNumber)}
                aria-describedby="slot-hint slot-error"
                onChange={(event) =>
                  updateDraft("slotNumber", event.target.value)
                }
              />
              <p className="field__hint" id="slot-hint">
                1〜1,000,000番から選びます。場所は保存後に移動できません。
              </p>
              <p className="field__error" id="slot-error">
                {fieldErrors.slotNumber}
              </p>
              {nearbyCandidates.length > 0 ? (
                <div className="candidate-list" aria-label="近くの場所候補">
                  <p>近くの候補（確定時に空きをもう一度確認します）</p>
                  <div>
                    {nearbyCandidates.map((candidate) => (
                      <button
                        key={candidate}
                        className="candidate-button"
                        type="button"
                        onClick={() =>
                          updateDraft("slotNumber", String(candidate))
                        }
                      >
                        {candidate.toLocaleString("ja-JP")}番
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <fieldset className="field choice-list">
              <legend>みんなの地図への掲載</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={draft.visibility === "public"}
                  disabled={inputsLocked}
                  onChange={() => updateDraft("visibility", "public")}
                />
                <span>
                  <strong>みんなの地図や一覧に表示する</strong>
                  <br />
                  <span className="fine-print">
                    地図、一覧、個別ページに表示されます。
                  </span>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="visibility"
                  value="unlisted"
                  checked={draft.visibility === "unlisted"}
                  disabled={inputsLocked}
                  onChange={() => updateDraft("visibility", "unlisted")}
                />
                <span>
                  <strong>リンクを知っている人に見せる</strong>
                  <br />
                  <span className="fine-print">
                    地図では使用中の場所としてだけ表示します。受け取った人がリンクを他の人へ渡すこともできます。
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="field choice-list">
              <legend>願い本文の公開</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="messageVisibility"
                  value="public"
                  checked={draft.messageVisibility === "public"}
                  disabled={inputsLocked}
                  onChange={() => updateDraft("messageVisibility", "public")}
                />
                <span>願いの本文も見せる</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="messageVisibility"
                  value="owner_only"
                  checked={draft.messageVisibility === "owner_only"}
                  disabled={inputsLocked}
                  onChange={() =>
                    updateDraft("messageVisibility", "owner_only")
                  }
                />
                <span>願いの本文は自分だけが見る</span>
              </label>
            </fieldset>

            {authState !== "ready" ? (
              <TurnstileChallenge
                siteKey={captchaSiteKey}
                required={captchaRequired}
                action="anonymous-auth"
                resetKey={captchaResetKey}
                onTokenChange={handleCaptchaTokenChange}
              />
            ) : null}

            <div className="status-stack" aria-live="polite" aria-atomic="true">
              {authState === "checking" ? (
                <p>編集できる状態を確認しています。</p>
              ) : null}
              {globalMessage ? (
                <p className="form-message form-message--error">
                  {globalMessage}
                </p>
              ) : null}
              {lastErrorCode === "OWNER_LIMIT_REACHED" ? (
                <Link className="button button--secondary" href="/me">
                  自分の絵馬を見る
                </Link>
              ) : null}
            </div>
            <div className="action-row">
              <button className="button" type="submit" disabled={inputsLocked}>
                入力内容を確認する
              </button>
              <button
                className="button button--quiet"
                type="button"
                disabled={inputsLocked}
                onClick={discardDraft}
              >
                下書きを破棄
              </button>
            </div>
          </form>
        ) : (
          <section
            ref={confirmationRef}
            className="form-card"
            aria-labelledby="confirmation-heading"
            tabIndex={-1}
          >
            <p className="eyebrow">保存前の確認</p>
            <h2 id="confirmation-heading">この内容で掛けますか</h2>
            <dl className="confirmation-list">
              <div>
                <dt>年・場所</dt>
                <dd>
                  {worldSlug}年・{validSlotNumber?.toLocaleString("ja-JP")}番
                </dd>
              </div>
              <div>
                <dt>掲載範囲</dt>
                <dd>
                  {draft.visibility === "public"
                    ? "みんなの地図や一覧に表示する"
                    : "リンクを知っている人に見せる"}
                </dd>
              </div>
              <div>
                <dt>願い本文</dt>
                <dd>
                  {draft.messageVisibility === "public"
                    ? "願いの本文も見せる"
                    : "願いの本文は自分だけが見る"}
                </dd>
              </div>
            </dl>
            {authState !== "ready" ? (
              <TurnstileChallenge
                siteKey={captchaSiteKey}
                required={captchaRequired}
                action="anonymous-auth"
                resetKey={captchaResetKey}
                onTokenChange={handleCaptchaTokenChange}
              />
            ) : null}
            <div className="status-stack" aria-live="polite" aria-atomic="true">
              {submitState === "saving" ? <p>絵馬を保存しています。</p> : null}
              {globalMessage ? (
                <p className="form-message form-message--error">
                  {globalMessage}
                </p>
              ) : null}
              {lastErrorCode === "OWNER_LIMIT_REACHED" ? (
                <Link className="button button--secondary" href="/me">
                  自分の絵馬を見る
                </Link>
              ) : null}
            </div>
            <div className="action-row">
              <button
                className="button"
                type="button"
                disabled={submitState === "saving" || retrySeconds > 0}
                onClick={() => void commitEma()}
              >
                {retrySeconds > 0
                  ? `あと${retrySeconds}秒お待ちください`
                  : submitState === "saving"
                    ? "保存しています…"
                    : submitState === "unknown"
                      ? "同じ内容で結果を確認する"
                      : "この場所に掛ける"}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={submitState === "saving" || submitState === "unknown"}
                onClick={() => {
                  setStep("write");
                  setGlobalMessage(null);
                }}
              >
                入力を修正する
              </button>
            </div>
            {submitState === "unknown" ? (
              <p className="fine-print">
                保存済みの可能性があるため、場所や文面を変えずに結果を確認します。
              </p>
            ) : null}
          </section>
        )}

        <aside
          className="stage-card stage-card--warm preview-panel"
          aria-labelledby="preview-heading"
        >
          <h2 id="preview-heading">公開時の見え方</h2>
          <PreviewSurfaceTabs
            value={previewSurface}
            onChange={setPreviewSurface}
          />
          <EmaPreview
            wishText={draft.wishText}
            nickname={draft.nickname}
            category={draft.category}
            visibility={draft.visibility}
            messageVisibility={draft.messageVisibility}
            surface={previewSurface}
            slotNumber={validSlotNumber}
          />
          <p>{previewCopy}</p>
        </aside>
      </div>
    </div>
  );
}
