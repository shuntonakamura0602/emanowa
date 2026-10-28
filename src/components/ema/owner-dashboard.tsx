"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  ownerEmaSchema,
  updateEmaInputSchema,
  type Category,
  type MessageVisibility,
  type OwnerEma,
  type UpdateEmaInput,
  type Visibility,
} from "@/domain/schemas";
import { countGraphemes, nicknameSchema, wishTextSchema } from "@/domain/text";

import {
  clearPrivateSessionData,
  EmailOwnership,
  type AuthSessionKind,
  type EmailPurpose,
} from "./email-ownership";
import {
  AuthBoundRequestCoordinator,
  AuthContextChangedError,
  assertStableAuthContextEpoch,
  captureStableAuthContextEpoch,
  interruptedMutationResolution,
} from "./auth-bound-operation";
import {
  AnonymousSessionCoordinationError,
  withAnonymousSessionLock,
} from "./anonymous-session-coordinator";
import {
  forceCommitPendingAuthContextChange,
  readAuthContextSnapshot,
  subscribeToAuthContextChanges,
} from "./auth-context-events";
import { EmaPreview } from "./ema-preview";
import {
  CATEGORY_OPTIONS,
  isApiError,
  isExpectedOwnerPublicId,
  isMutationReceipt,
  messageForApiError,
} from "./ui-contracts";

type LoadState =
  "loading" | "ready" | "auth_required" | "not_owned" | "error" | "deleted";
type MutationState = "idle" | "saving" | "unknown";
type AuthReconciliationOutcome =
  "cancelled" | "link_succeeded" | "remote_link_settled";

type OwnerForm = {
  wishText: string;
  nickname: string;
  category: Category;
  visibility: Visibility;
  messageVisibility: MessageVisibility;
};

type PendingMutation = {
  kind: "update" | "delete";
  key: string;
  payload: string;
};

const EMPTY_OWNER_FORM: OwnerForm = {
  wishText: "",
  nickname: "",
  category: "other",
  visibility: "public",
  messageVisibility: "public",
};

async function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function formFromEma(ema: OwnerEma): OwnerForm {
  return {
    wishText: ema.wishText,
    nickname: ema.nickname ?? "",
    category: ema.category,
    visibility: ema.visibility,
    messageVisibility: ema.messageVisibility,
  };
}

function canonicalMutationPayload(input: object): string {
  return JSON.stringify(input);
}

export function OwnerDashboard({
  worldSlug,
  expectedPublicId,
  captchaSiteKey,
  captchaRequired,
}: {
  worldSlug: string;
  expectedPublicId?: string;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [ema, setEma] = useState<OwnerEma | null>(null);
  const emaRef = useRef<OwnerEma | null>(null);
  const setCurrentEma = useCallback((next: OwnerEma | null): void => {
    emaRef.current = next;
    setEma(next);
  }, []);
  const [form, setForm] = useState<OwnerForm>(EMPTY_OWNER_FORM);
  const [mutationState, setMutationStateValue] =
    useState<MutationState>("idle");
  const mutationStateRef = useRef<MutationState>("idle");
  const setMutationState = useCallback((next: MutationState): void => {
    mutationStateRef.current = next;
    setMutationStateValue(next);
  }, []);
  const interruptedMutationRef = useRef(false);
  const authTransitionGenerationRef = useRef(0);
  const authReconciliationOutcomeRef =
    useRef<AuthReconciliationOutcome>("cancelled");
  const [pendingMutation, setPendingMutation] =
    useState<PendingMutation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof OwnerForm, string>>
  >({});
  const [conflictEma, setConflictEma] = useState<OwnerEma | null>(null);
  const [authSessionKind, setAuthSessionKind] =
    useState<AuthSessionKind>("none");
  const [authPanelKey, setAuthPanelKey] = useState(0);
  const [authTransitionPending, setAuthTransitionPending] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const wishRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [authBoundRequests] = useState(() => new AuthBoundRequestCoordinator());

  const formLocked = mutationState === "saving" || mutationState === "unknown";
  const wishCount = countGraphemes(form.wishText);
  const nicknameCount = countGraphemes(form.nickname);
  const emaMatchesExpectedPublicId =
    ema !== null && isExpectedOwnerPublicId(expectedPublicId, ema.publicId);

  const loadOwner = useCallback(
    async (
      options: {
        preserveDraftFor?: { publicId: string; version: number };
        afterRecovery?: boolean;
        preserveInterruptedMutation?: boolean;
        background?: boolean;
      } = {},
    ): Promise<OwnerEma | null> => {
      const operation = authBoundRequests.start();
      const discardUnverifiedPrivateState = (): void => {
        setCurrentEma(null);
        setForm(EMPTY_OWNER_FORM);
        setConflictEma(null);
        setPendingMutation(null);
        setMutationState("idle");
        interruptedMutationRef.current = false;
        setFieldErrors({});
        if (options.afterRecovery) clearPrivateSessionData();
      };

      if (!options.background) {
        setLoadState("loading");
        setMessage(null);
      }
      try {
        const { response, body, authContextEpoch } =
          await withAnonymousSessionLock(async () => {
            const authContextEpoch = captureStableAuthContextEpoch(
              readAuthContextSnapshot(),
            );
            operation.assertCurrent();
            const response = await fetch(
              `/api/v1/me/emas?world=${encodeURIComponent(worldSlug)}`,
              {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json" },
                signal: operation.signal,
              },
            );
            const body = await safeJson(response);
            operation.assertCurrent();
            assertStableAuthContextEpoch(
              authContextEpoch,
              readAuthContextSnapshot(),
            );
            return { response, body, authContextEpoch };
          });
        operation.assertCurrent();
        assertStableAuthContextEpoch(
          authContextEpoch,
          readAuthContextSnapshot(),
        );
        if (!response.ok) {
          if (
            isApiError(body) &&
            (body.error.code === "AUTH_REQUIRED" ||
              body.error.code === "SESSION_EXPIRED")
          ) {
            setLoadState("auth_required");
            setAuthSessionKind("none");
            setAuthPanelKey((current) => current + 1);
            if (!options.preserveDraftFor || options.afterRecovery) {
              discardUnverifiedPrivateState();
            }
            setMessage(
              "編集できる状態を確認できませんでした。メールで復元できます。",
            );
            return null;
          }
          setLoadState("error");
          if (options.afterRecovery) discardUnverifiedPrivateState();
          setMessage(
            isApiError(body)
              ? messageForApiError(body.error)
              : "自分の絵馬を読み込めませんでした。",
          );
          return null;
        }

        const responseAuthKind = response.headers.get("x-emanowa-auth-kind");
        if (
          responseAuthKind !== "anonymous" &&
          responseAuthKind !== "registered"
        ) {
          setLoadState("error");
          setAuthSessionKind("none");
          if (options.afterRecovery) discardUnverifiedPrivateState();
          setMessage("本人確認の応答を確認できませんでした。");
          return null;
        }
        setAuthSessionKind(responseAuthKind);

        const candidate =
          body && typeof body === "object" && "ema" in body
            ? (body as { ema: unknown }).ema
            : undefined;
        if (candidate === null) {
          setLoadState(expectedPublicId ? "not_owned" : "ready");
          discardUnverifiedPrivateState();
          return null;
        }
        const parsed = ownerEmaSchema.safeParse(candidate);
        if (!parsed.success) {
          setLoadState("error");
          if (options.afterRecovery) discardUnverifiedPrivateState();
          setMessage("自分の絵馬の応答を確認できませんでした。");
          return null;
        }
        if (!isExpectedOwnerPublicId(expectedPublicId, parsed.data.publicId)) {
          discardUnverifiedPrivateState();
          setLoadState("not_owned");
          return null;
        }
        const sameOwner =
          options.preserveDraftFor?.publicId === parsed.data.publicId;
        setLoadState("ready");
        if (
          options.preserveDraftFor &&
          options.preserveInterruptedMutation &&
          interruptedMutationResolution(
            options.preserveDraftFor,
            parsed.data,
          ) === "replay"
        ) {
          setMutationState("unknown");
          return parsed.data;
        }
        setCurrentEma(parsed.data);
        if (!sameOwner) {
          if (options.afterRecovery) {
            discardUnverifiedPrivateState();
            setCurrentEma(parsed.data);
            setForm(formFromEma(parsed.data));
          } else {
            setForm(formFromEma(parsed.data));
            setConflictEma(null);
            setPendingMutation(null);
            setMutationState("idle");
            setFieldErrors({});
          }
        } else if (
          options.preserveDraftFor &&
          options.preserveDraftFor.version !== parsed.data.version
        ) {
          setConflictEma(parsed.data);
          setPendingMutation(null);
          setMutationState("idle");
        }
        return parsed.data;
      } catch (error) {
        if (
          !operation.isCurrent() ||
          error instanceof AuthContextChangedError ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return null;
        }
        setLoadState("error");
        setAuthSessionKind("none");
        if (options.afterRecovery) discardUnverifiedPrivateState();
        setMessage(
          error instanceof AnonymousSessionCoordinationError
            ? "本人情報をタブ間で安全に確認できませんでした。対応ブラウザーで再度お試しください。"
            : "自分の絵馬を読み込めませんでした。通信状態を確認してください。",
        );
        return null;
      } finally {
        operation.finish();
      }
    },
    [
      authBoundRequests,
      expectedPublicId,
      setCurrentEma,
      setMutationState,
      worldSlug,
    ],
  );

  const markAuthTransitionPending = useCallback((): void => {
    authTransitionGenerationRef.current += 1;
    authReconciliationOutcomeRef.current = "cancelled";
    if (mutationStateRef.current !== "idle") {
      interruptedMutationRef.current = true;
      if (mutationStateRef.current === "saving") {
        setMutationState("unknown");
      }
    }
    authBoundRequests.invalidate();
    setAuthTransitionPending(true);
  }, [authBoundRequests, setMutationState]);

  const reconcileCancelledAuthTransition = useCallback(
    async (
      options: { outcome?: AuthReconciliationOutcome } = {},
    ): Promise<void> => {
      const transitionGeneration = authTransitionGenerationRef.current;
      const outcome = options.outcome ?? authReconciliationOutcomeRef.current;
      authReconciliationOutcomeRef.current = outcome;
      setAuthTransitionPending(false);
      const currentEma = emaRef.current;
      const preserveDraftFor = currentEma
        ? { publicId: currentEma.publicId, version: currentEma.version }
        : undefined;
      const preserveInterruptedMutation = interruptedMutationRef.current;
      const refreshed = await loadOwner({
        preserveDraftFor,
        preserveInterruptedMutation,
        background: true,
      });
      if (transitionGeneration !== authTransitionGenerationRef.current) return;
      if (!refreshed) return;
      interruptedMutationRef.current = false;

      if (
        preserveInterruptedMutation &&
        preserveDraftFor &&
        refreshed.publicId === preserveDraftFor.publicId
      ) {
        setMessageTone("error");
        setMessage(
          outcome === "link_succeeded"
            ? "メール連携は完了しましたが、直前の保存結果は不明です。同じ内容と送信番号で結果を確認できます。"
            : outcome === "remote_link_settled"
              ? "別のタブのメール連携操作は終了しましたが、直前の保存結果は不明です。同じ内容と送信番号で結果を確認できます。"
              : "本人情報変更は取り消されましたが、直前の保存結果は不明です。同じ内容と送信番号で結果を確認できます。",
        );
        return;
      }
      if (outcome !== "cancelled") {
        setMessage(null);
        return;
      }
      setMessageTone("error");
      setMessage(
        "本人情報変更は完了しませんでした。未保存の編集内容を保持しています。",
      );
    },
    [loadOwner],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (readAuthContextSnapshot().phase === "pending") {
        setAuthTransitionPending(true);
        setLoadState("loading");
        return;
      }
      void loadOwner();
    });
    return () => {
      cancelAnimationFrame(frame);
      authBoundRequests.invalidate();
    };
  }, [authBoundRequests, loadOwner]);

  useEffect(
    () =>
      subscribeToAuthContextChanges((change) => {
        deleteDialogRef.current?.close();
        if (change.phase === "pending") {
          markAuthTransitionPending();
          setMessage(
            "別のタブの本人情報変更が完了するまで、本人限定内容を一時的に隠しています。",
          );
          return;
        }
        if (change.phase === "cancelled") {
          void reconcileCancelledAuthTransition({
            outcome:
              change.reason === "link" ? "remote_link_settled" : "cancelled",
          });
          return;
        }
        authBoundRequests.invalidate();
        interruptedMutationRef.current = false;
        setAuthTransitionPending(false);
        clearPrivateSessionData();
        setCurrentEma(null);
        setForm(EMPTY_OWNER_FORM);
        setConflictEma(null);
        setPendingMutation(null);
        setMutationState("idle");
        setFieldErrors({});
        setAuthSessionKind("none");
        setAuthPanelKey((current) => current + 1);
        setLoadState("auth_required");
        setMessageTone("error");
        setMessage(
          "別のタブで本人情報が変更されました。再読み込みするか、メールで復元してください。",
        );
      }),
    [
      authBoundRequests,
      markAuthTransitionPending,
      reconcileCancelledAuthTransition,
      setCurrentEma,
      setMutationState,
    ],
  );

  function updateField<K extends keyof OwnerForm>(
    field: K,
    value: OwnerForm[K],
  ): void {
    if (formLocked) return;
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setMessage(null);
  }

  function buildUpdateInput(): {
    input: UpdateEmaInput | null;
    errors: Partial<Record<keyof OwnerForm, string>>;
    unchanged: boolean;
  } {
    if (!ema) return { input: null, errors: {}, unchanged: true };
    const candidate: Record<string, unknown> = {
      expectedVersion: ema.version,
    };
    const errors: Partial<Record<keyof OwnerForm, string>> = {};

    if (ema.capabilities.editContent) {
      const wish = wishTextSchema.safeParse(form.wishText);
      if (!wish.success) errors.wishText = wish.error.issues[0]?.message;
      else if (wish.data !== ema.wishText) candidate.wishText = wish.data;

      const nickname = nicknameSchema.safeParse(form.nickname);
      if (!nickname.success)
        errors.nickname = nickname.error.issues[0]?.message;
      else if (nickname.data !== ema.nickname)
        candidate.nickname = nickname.data;

      if (form.category !== ema.category) candidate.category = form.category;
    }

    if (form.visibility !== ema.visibility)
      candidate.visibility = form.visibility;
    if (form.messageVisibility !== ema.messageVisibility) {
      candidate.messageVisibility = form.messageVisibility;
    }

    if (Object.keys(errors).length > 0) {
      return { input: null, errors, unchanged: false };
    }
    if (Object.keys(candidate).length === 1) {
      return { input: null, errors: {}, unchanged: true };
    }
    const parsed = updateEmaInputSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        input: null,
        errors: { wishText: parsed.error.issues[0]?.message },
        unchanged: false,
      };
    }
    return { input: parsed.data, errors: {}, unchanged: false };
  }

  function mutationIdentity(
    kind: "update" | "delete",
    payload: string,
  ): PendingMutation {
    if (pendingMutation?.kind === kind && pendingMutation.payload === payload) {
      return pendingMutation;
    }
    const next = { kind, payload, key: crypto.randomUUID() } as const;
    setPendingMutation(next);
    return next;
  }

  async function loadConflict(): Promise<void> {
    const operation = authBoundRequests.start();
    try {
      const { response, body, authContextEpoch } =
        await withAnonymousSessionLock(async () => {
          const authContextEpoch = captureStableAuthContextEpoch(
            readAuthContextSnapshot(),
          );
          operation.assertCurrent();
          const response = await fetch(
            `/api/v1/me/emas?world=${encodeURIComponent(worldSlug)}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: operation.signal,
            },
          );
          const body = await safeJson(response);
          operation.assertCurrent();
          assertStableAuthContextEpoch(
            authContextEpoch,
            readAuthContextSnapshot(),
          );
          return { response, body, authContextEpoch };
        });
      operation.assertCurrent();
      assertStableAuthContextEpoch(authContextEpoch, readAuthContextSnapshot());
      const candidate =
        response.ok && body && typeof body === "object" && "ema" in body
          ? (body as { ema: unknown }).ema
          : null;
      if (response.ok && candidate === null) {
        setCurrentEma(null);
        setForm(EMPTY_OWNER_FORM);
        setConflictEma(null);
        setPendingMutation(null);
        setMutationState("idle");
        setFieldErrors({});
        setLoadState(expectedPublicId ? "not_owned" : "ready");
        setMessage("別の画面でこの絵馬が削除されました。");
        return;
      }
      const parsed = ownerEmaSchema.safeParse(candidate);
      if (parsed.success) {
        if (!isExpectedOwnerPublicId(expectedPublicId, parsed.data.publicId)) {
          setCurrentEma(null);
          setForm(EMPTY_OWNER_FORM);
          setConflictEma(null);
          setPendingMutation(null);
          setMutationState("idle");
          setFieldErrors({});
          setLoadState("not_owned");
          return;
        }
        setConflictEma(parsed.data);
      }
    } catch {
      // The conflict message remains useful even when the comparison fetch fails.
    } finally {
      operation.finish();
    }
  }

  async function saveChanges(
    event?: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event?.preventDefault();
    if (
      composingRef.current ||
      (event?.nativeEvent as InputEvent | undefined)?.isComposing
    ) {
      return;
    }
    if (!ema) return;
    const built = buildUpdateInput();
    if (!built.input) {
      if (built.unchanged) {
        setMessageTone("success");
        setMessage("変更はありません。");
      } else {
        setMessageTone("error");
        setMessage("入力内容を確認してください。");
        setFieldErrors(built.errors);
        requestAnimationFrame(() => wishRef.current?.focus());
      }
      return;
    }

    const payload = canonicalMutationPayload(built.input);
    const mutation = mutationIdentity("update", payload);
    const operation = authBoundRequests.start();
    setMutationState("saving");
    setMessage(null);
    try {
      const { response, body, authContextEpoch } =
        await withAnonymousSessionLock(async () => {
          const authContextEpoch = captureStableAuthContextEpoch(
            readAuthContextSnapshot(),
          );
          operation.assertCurrent();
          const response = await fetch(
            `/api/v1/me/emas/${encodeURIComponent(ema.publicId)}`,
            {
              method: "PATCH",
              credentials: "same-origin",
              cache: "no-store",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": mutation.key,
              },
              body: payload,
              signal: operation.signal,
            },
          );
          const body = await safeJson(response);
          operation.assertCurrent();
          assertStableAuthContextEpoch(
            authContextEpoch,
            readAuthContextSnapshot(),
          );
          return { response, body, authContextEpoch };
        });
      operation.assertCurrent();
      assertStableAuthContextEpoch(authContextEpoch, readAuthContextSnapshot());
      if (!response.ok) {
        setMutationState("idle");
        setMessageTone("error");
        if (isApiError(body)) {
          setMessage(messageForApiError(body.error));
          if (body.error.code === "VERSION_CONFLICT") {
            await loadConflict();
          } else if (
            body.error.code === "AUTH_REQUIRED" ||
            body.error.code === "SESSION_EXPIRED"
          ) {
            setLoadState("auth_required");
            setAuthSessionKind("none");
            setAuthPanelKey((current) => current + 1);
          }
        } else {
          setMessage("変更を保存できませんでした。もう一度お試しください。");
        }
        return;
      }
      const receipt =
        body && typeof body === "object" && "receipt" in body
          ? (body as { receipt: unknown }).receipt
          : null;
      if (!isMutationReceipt(receipt) || receipt.result !== "updated") {
        setMutationState("unknown");
        setMessageTone("error");
        setMessage("送信結果を確認できませんでした。");
        return;
      }
      setMutationState("idle");
      setPendingMutation(null);
      const refreshed = await loadOwner();
      if (refreshed) {
        setMessageTone("success");
        setMessage("変更を保存しました。");
      }
    } catch (error) {
      if (
        !operation.isCurrent() ||
        error instanceof AuthContextChangedError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      setMutationState("unknown");
      setMessageTone("error");
      setMessage(
        error instanceof AnonymousSessionCoordinationError
          ? "本人情報をタブ間で安全に確認できませんでした。対応ブラウザーで再度お試しください。"
          : "送信結果を確認できませんでした。",
      );
    } finally {
      operation.finish();
    }
  }

  async function deleteEma(): Promise<void> {
    if (!ema) return;
    const payload = canonicalMutationPayload({ expectedVersion: ema.version });
    const mutation = mutationIdentity("delete", payload);
    const operation = authBoundRequests.start();
    setMutationState("saving");
    setMessage(null);
    try {
      const { response, body, authContextEpoch } =
        await withAnonymousSessionLock(async () => {
          const authContextEpoch = captureStableAuthContextEpoch(
            readAuthContextSnapshot(),
          );
          operation.assertCurrent();
          const response = await fetch(
            `/api/v1/me/emas/${encodeURIComponent(ema.publicId)}`,
            {
              method: "DELETE",
              credentials: "same-origin",
              cache: "no-store",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": mutation.key,
              },
              body: payload,
              signal: operation.signal,
            },
          );
          const body = await safeJson(response);
          operation.assertCurrent();
          assertStableAuthContextEpoch(
            authContextEpoch,
            readAuthContextSnapshot(),
          );
          return { response, body, authContextEpoch };
        });
      operation.assertCurrent();
      assertStableAuthContextEpoch(authContextEpoch, readAuthContextSnapshot());
      if (!response.ok) {
        setMutationState("idle");
        setMessageTone("error");
        setMessage(
          isApiError(body)
            ? messageForApiError(body.error)
            : "削除できませんでした。もう一度お試しください。",
        );
        if (isApiError(body) && body.error.code === "VERSION_CONFLICT") {
          deleteDialogRef.current?.close();
          await loadConflict();
        } else if (
          isApiError(body) &&
          (body.error.code === "AUTH_REQUIRED" ||
            body.error.code === "SESSION_EXPIRED")
        ) {
          deleteDialogRef.current?.close();
          setLoadState("auth_required");
          setAuthSessionKind("none");
          setAuthPanelKey((current) => current + 1);
        }
        return;
      }
      const receipt =
        body && typeof body === "object" && "receipt" in body
          ? (body as { receipt: unknown }).receipt
          : null;
      if (!isMutationReceipt(receipt) || receipt.result !== "deleted") {
        setMutationState("unknown");
        setMessageTone("error");
        setMessage("送信結果を確認できませんでした。");
        return;
      }
      deleteDialogRef.current?.close();
      setMutationState("idle");
      setPendingMutation(null);
      setCurrentEma(null);
      setForm(EMPTY_OWNER_FORM);
      setLoadState("deleted");
      setMessageTone("success");
      setMessage("絵馬を削除しました。");
    } catch (error) {
      if (
        !operation.isCurrent() ||
        error instanceof AuthContextChangedError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      setMutationState("unknown");
      setMessageTone("error");
      setMessage(
        error instanceof AnonymousSessionCoordinationError
          ? "本人情報をタブ間で安全に確認できませんでした。対応ブラウザーで再度お試しください。"
          : "送信結果を確認できませんでした。",
      );
    } finally {
      operation.finish();
    }
  }

  function useCurrentSavedContent(): void {
    if (!conflictEma) return;
    setCurrentEma(conflictEma);
    setForm(formFromEma(conflictEma));
    setConflictEma(null);
    setPendingMutation(null);
    setMessageTone("success");
    setMessage("現在保存されている内容をフォームへ反映しました。");
  }

  function keepMyDraftAfterConflict(): void {
    if (!conflictEma) return;
    setCurrentEma(conflictEma);
    setConflictEma(null);
    setPendingMutation(null);
    setMessageTone("success");
    setMessage(
      "自分の編集内容を残しました。内容を確認して、もう一度保存してください。",
    );
  }

  async function handleVerified(purpose: EmailPurpose): Promise<void> {
    const preserveDraftFor = ema
      ? { publicId: ema.publicId, version: ema.version }
      : undefined;
    if (purpose === "link") {
      await reconcileCancelledAuthTransition({ outcome: "link_succeeded" });
      return;
    }
    const preserveInterruptedMutation = interruptedMutationRef.current;
    authBoundRequests.invalidate();
    setAuthTransitionPending(false);
    const refreshed = await loadOwner({
      preserveDraftFor,
      afterRecovery: purpose === "recover",
      preserveInterruptedMutation,
    });
    if (refreshed) interruptedMutationRef.current = false;
  }

  function handleSignedOut(): void {
    authBoundRequests.invalidate();
    interruptedMutationRef.current = false;
    setAuthTransitionPending(false);
    deleteDialogRef.current?.close();
    setCurrentEma(null);
    setForm(EMPTY_OWNER_FORM);
    setConflictEma(null);
    setPendingMutation(null);
    setMutationState("idle");
    setFieldErrors({});
    setAuthSessionKind("none");
    setLoadState("auth_required");
    setMessageTone("error");
    setMessage(null);
  }

  const ownershipPanel = (
    <EmailOwnership
      key={authPanelKey}
      sessionKind={authSessionKind}
      captchaSiteKey={captchaSiteKey}
      captchaRequired={captchaRequired}
      transitionPending={authTransitionPending}
      onVerified={handleVerified}
      onSignedOut={handleSignedOut}
      onTransitionPending={markAuthTransitionPending}
      onTransitionSettled={() => void reconcileCancelledAuthTransition()}
    />
  );

  if (authTransitionPending) {
    return (
      <div className="owner-layout">
        <section
          className="stage-card owner-loading"
          aria-live="polite"
          aria-busy="true"
        >
          <h2>本人情報を確認しています</h2>
          <p>
            操作が完了するまで、本人限定内容と未保存編集を一時的に隠しています。
          </p>
          <button
            className="button button--danger"
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  "操作が中断された場合の復旧を続けますか。未保存の編集と本人限定表示は安全のため破棄され、元に戻せません。",
                )
              ) {
                return;
              }
              const committed = forceCommitPendingAuthContextChange();
              if (!committed) return;
              clearPrivateSessionData();
              handleSignedOut();
              setMessage(
                "中断された本人情報変更から復旧しました。メールで本人情報を確認してください。",
              );
            }}
          >
            中断した操作から安全に復旧する
          </button>
        </section>
        {ownershipPanel}
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="owner-layout">
        <section
          className="stage-card owner-loading"
          aria-live="polite"
          aria-busy="true"
        >
          <h2>所有する絵馬</h2>
          <p>編集できる状態を確認しています。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="owner-layout">
      <section
        className="stage-card owner-card"
        aria-labelledby="owner-ema-heading"
      >
        <h2 id="owner-ema-heading">所有する絵馬</h2>

        {loadState === "error" ? (
          <div className="state-panel" role="alert">
            <h3>読み込めませんでした</h3>
            <p>{message}</p>
            <button
              className="button"
              type="button"
              onClick={() => {
                if (interruptedMutationRef.current) {
                  void reconcileCancelledAuthTransition();
                } else {
                  void loadOwner();
                }
              }}
            >
              もう一度読み込む
            </button>
          </div>
        ) : null}

        {loadState === "auth_required" ? (
          <div className="state-panel">
            <h3>本人確認が必要です</h3>
            <p>{message}</p>
            <p className="fine-print">
              公開作品へのリンクだけでは編集できません。以前に設定したメールから復元してください。
            </p>
          </div>
        ) : null}

        {loadState === "not_owned" ||
        (loadState === "ready" &&
          expectedPublicId !== undefined &&
          !emaMatchesExpectedPublicId) ? (
          <div className="state-panel" role="status">
            <h3>この絵馬を編集できません</h3>
            <p>
              このURLの絵馬と、現在確認できる本人情報が一致しません。別の利用者の内容は表示していません。
            </p>
            <p className="fine-print">
              以前に設定したメールから本人情報を復元するか、自分の絵馬の管理画面を確認してください。
            </p>
            <Link className="button button--secondary" href="/me">
              自分の絵馬を確認する
            </Link>
          </div>
        ) : null}

        {loadState === "deleted" ? (
          <div className="state-panel" aria-live="polite">
            <h3>絵馬を削除しました</h3>
            <p>本文と表示名は、新しい公開ページや地図には表示されません。</p>
            <Link
              className="button"
              href={`/w/${encodeURIComponent(worldSlug)}`}
            >
              {worldSlug}年のえまのわへ戻る
            </Link>
          </div>
        ) : null}

        {loadState === "ready" && expectedPublicId === undefined && !ema ? (
          <div className="state-panel">
            <h3>この年の絵馬はまだありません</h3>
            <p>願いを書くと、この端末から編集や削除ができます。</p>
            <Link
              className="button"
              href={`/w/${encodeURIComponent(worldSlug)}/new`}
            >
              絵馬を書く
            </Link>
          </div>
        ) : null}

        {loadState === "ready" && ema && emaMatchesExpectedPublicId ? (
          <>
            {ema.status === "hidden" ? (
              <div className="form-message form-message--error" role="status">
                この絵馬は運営により公開を停止しています。本文は本人画面だけで確認できます。
              </div>
            ) : null}
            <div className="owner-summary">
              <EmaPreview
                wishText={form.wishText}
                nickname={form.nickname}
                category={form.category}
                visibility={form.visibility}
                messageVisibility={form.messageVisibility}
                surface="link"
                slotNumber={ema.slotNumber}
              />
              <dl className="confirmation-list">
                <div>
                  <dt>年・場所</dt>
                  <dd>
                    {worldSlug}年・{ema.slotNumber.toLocaleString("ja-JP")}番
                  </dd>
                </div>
                <div>
                  <dt>更新版</dt>
                  <dd>version {ema.version}</dd>
                </div>
              </dl>
            </div>

            <form
              className="owner-edit-form"
              onSubmit={(event) => void saveChanges(event)}
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
                <label htmlFor="owner-wish">叶えたいことを書いてください</label>
                <textarea
                  ref={wishRef}
                  id="owner-wish"
                  name="wishText"
                  rows={4}
                  value={form.wishText}
                  disabled={formLocked || !ema.capabilities.editContent}
                  aria-invalid={Boolean(fieldErrors.wishText)}
                  aria-describedby="owner-wish-count owner-wish-error"
                  onChange={(event) =>
                    updateField("wishText", event.target.value)
                  }
                />
                <p
                  id="owner-wish-count"
                  className={
                    wishCount > 80
                      ? "character-count character-count--over"
                      : "character-count"
                  }
                >
                  {wishCount}/80文字
                </p>
                <p className="field__error" id="owner-wish-error">
                  {fieldErrors.wishText}
                </p>
              </div>

              <div className="field">
                <label htmlFor="owner-nickname">表示名（任意）</label>
                <input
                  id="owner-nickname"
                  name="nickname"
                  value={form.nickname}
                  disabled={formLocked || !ema.capabilities.editContent}
                  aria-invalid={Boolean(fieldErrors.nickname)}
                  aria-describedby="owner-nickname-hint owner-nickname-count owner-nickname-error"
                  onChange={(event) =>
                    updateField("nickname", event.target.value)
                  }
                />
                <p className="field__hint" id="owner-nickname-hint">
                  表示名は公開情報です。未入力時は「ななしさん」です。
                </p>
                <p
                  id="owner-nickname-count"
                  className={
                    nicknameCount > 20
                      ? "character-count character-count--over"
                      : "character-count"
                  }
                >
                  {nicknameCount}/20文字
                </p>
                <p className="field__error" id="owner-nickname-error">
                  {fieldErrors.nickname}
                </p>
              </div>

              <div className="field">
                <label htmlFor="owner-category">願いの種類</label>
                <select
                  id="owner-category"
                  name="category"
                  value={form.category}
                  disabled={formLocked || !ema.capabilities.editContent}
                  onChange={(event) =>
                    updateField("category", event.target.value as Category)
                  }
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="field choice-list">
                <legend>みんなの地図への掲載</legend>
                <label className="choice">
                  <input
                    type="radio"
                    name="ownerVisibility"
                    value="public"
                    checked={form.visibility === "public"}
                    disabled={
                      formLocked ||
                      ema.capabilities.visibilityMode === "none" ||
                      (ema.capabilities.visibilityMode === "restrict_only" &&
                        ema.visibility === "unlisted")
                    }
                    onChange={() => updateField("visibility", "public")}
                  />
                  <span>みんなの地図や一覧に表示する</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="ownerVisibility"
                    value="unlisted"
                    checked={form.visibility === "unlisted"}
                    disabled={
                      formLocked || ema.capabilities.visibilityMode === "none"
                    }
                    onChange={() => updateField("visibility", "unlisted")}
                  />
                  <span>リンクを知っている人に見せる</span>
                </label>
              </fieldset>

              <fieldset className="field choice-list">
                <legend>願い本文の公開</legend>
                <label className="choice">
                  <input
                    type="radio"
                    name="ownerMessageVisibility"
                    value="public"
                    checked={form.messageVisibility === "public"}
                    disabled={
                      formLocked ||
                      ema.capabilities.visibilityMode === "none" ||
                      (ema.capabilities.visibilityMode === "restrict_only" &&
                        ema.messageVisibility === "owner_only")
                    }
                    onChange={() => updateField("messageVisibility", "public")}
                  />
                  <span>願いの本文も見せる</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name="ownerMessageVisibility"
                    value="owner_only"
                    checked={form.messageVisibility === "owner_only"}
                    disabled={
                      formLocked || ema.capabilities.visibilityMode === "none"
                    }
                    onChange={() =>
                      updateField("messageVisibility", "owner_only")
                    }
                  />
                  <span>願いの本文は自分だけが見る</span>
                </label>
              </fieldset>

              {ema.capabilities.visibilityMode === "restrict_only" ? (
                <p className="fine-print">
                  この年は受付終了後のため、削除と公開範囲を狭める変更だけを利用できます。
                </p>
              ) : null}

              {conflictEma ? (
                <section
                  className="conflict-panel"
                  aria-labelledby="conflict-heading"
                >
                  <h3 id="conflict-heading">
                    現在保存されている内容が更新されています
                  </h3>
                  <p>
                    現在のversionは {conflictEma.version}{" "}
                    です。無断では上書きしません。
                  </p>
                  <blockquote>{conflictEma.wishText}</blockquote>
                  <div className="action-row">
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={useCurrentSavedContent}
                    >
                      現在の内容をフォームに反映
                    </button>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={keepMyDraftAfterConflict}
                    >
                      自分の編集内容を残す
                    </button>
                  </div>
                </section>
              ) : null}

              <div
                className="status-stack"
                aria-live="polite"
                aria-atomic="true"
              >
                {mutationState === "saving" ? (
                  <p>変更を保存しています。</p>
                ) : null}
                {message ? (
                  <p
                    className={
                      messageTone === "error"
                        ? "form-message form-message--error"
                        : "form-message form-message--success"
                    }
                  >
                    {message}
                  </p>
                ) : null}
              </div>

              <div className="action-row">
                <button
                  className="button"
                  type="submit"
                  disabled={mutationState === "saving" || Boolean(conflictEma)}
                >
                  {mutationState === "saving"
                    ? "保存しています…"
                    : mutationState === "unknown" &&
                        pendingMutation?.kind === "update"
                      ? "同じ内容で結果を確認する"
                      : "変更を保存する"}
                </button>
                <Link
                  className="button button--secondary"
                  href={`/w/${encodeURIComponent(worldSlug)}/e/${ema.publicId}`}
                >
                  公開ページを見る
                </Link>
              </div>
              {mutationState === "unknown" ? (
                <p className="fine-print">
                  保存済みの可能性があるため、内容を変えず同じ送信番号で確認します。
                </p>
              ) : null}
            </form>

            {ema.capabilities.delete ? (
              <section className="danger-zone" aria-labelledby="danger-heading">
                <h3 id="danger-heading">絵馬を削除する</h3>
                <p>
                  削除後は元に戻せません。以前の作品URLは別の作品へ付け替えません。
                </p>
                <button
                  ref={deleteButtonRef}
                  className="button button--danger"
                  type="button"
                  onClick={() => deleteDialogRef.current?.showModal()}
                >
                  削除する
                </button>
              </section>
            ) : null}

            <dialog
              ref={deleteDialogRef}
              className="confirmation-dialog"
              aria-labelledby="delete-dialog-heading"
              onClose={() => deleteButtonRef.current?.focus()}
            >
              <h2 id="delete-dialog-heading">絵馬の削除</h2>
              <p>この絵馬を削除しますか。元に戻すことはできません。</p>
              {message && pendingMutation?.kind === "delete" ? (
                <p
                  className="form-message form-message--error"
                  aria-live="polite"
                >
                  {message}
                </p>
              ) : null}
              <div className="action-row">
                <button
                  className="button button--danger"
                  type="button"
                  disabled={mutationState === "saving"}
                  onClick={() => void deleteEma()}
                >
                  {mutationState === "saving" &&
                  pendingMutation?.kind === "delete"
                    ? "削除しています…"
                    : mutationState === "unknown" &&
                        pendingMutation?.kind === "delete"
                      ? "同じ内容で結果を確認する"
                      : "削除を確定する"}
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={
                    mutationState === "saving" || mutationState === "unknown"
                  }
                  onClick={() => deleteDialogRef.current?.close()}
                >
                  キャンセル
                </button>
              </div>
            </dialog>
          </>
        ) : null}
      </section>

      {loadState !== "error" ? ownershipPanel : null}
    </div>
  );
}
