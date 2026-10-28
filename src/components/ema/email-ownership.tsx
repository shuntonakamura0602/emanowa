"use client";

import { useRef, useState, type FormEvent } from "react";

import { TurnstileChallenge } from "../auth/turnstile-challenge";
import { withAnonymousSessionLock } from "./anonymous-session-coordinator";
import {
  AuthContextTransitionError,
  readAuthContextSnapshot,
  runAuthContextChange,
} from "./auth-context-events";
import { isApiError, messageForApiError } from "./ui-contracts";

export type EmailPurpose = "link" | "recover";
export type AuthSessionKind = "none" | "anonymous" | "registered";
type EmailState =
  "idle" | "sending" | "code" | "verifying" | "success" | "error";

async function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

export function clearPrivateSessionData(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("emanowa:draft:")) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Parent state still drops the private form when storage is unavailable.
  }
}

export function EmailOwnership({
  sessionKind,
  captchaSiteKey,
  captchaRequired,
  transitionPending,
  onVerified,
  onSignedOut,
  onTransitionPending,
  onTransitionSettled,
}: {
  sessionKind: AuthSessionKind;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
  transitionPending: boolean;
  onVerified: (purpose: EmailPurpose) => void | Promise<void>;
  onSignedOut: () => void;
  onTransitionPending: () => void;
  onTransitionSettled: () => void;
}) {
  const purpose: EmailPurpose | null =
    sessionKind === "anonymous"
      ? "link"
      : sessionKind === "none"
        ? "recover"
        : null;
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<EmailState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const composingRef = useRef(false);
  const recoveryChallengeRequired = purpose === "recover" && captchaRequired;

  async function requestCode(
    event?: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event?.preventDefault();
    if (
      composingRef.current ||
      (event?.nativeEvent as InputEvent | undefined)?.isComposing
    ) {
      return;
    }
    if (!purpose) return;
    if (!email.trim()) {
      setState("error");
      setMessage("メールアドレスを入力してください。");
      return;
    }
    if (recoveryChallengeRequired && !captchaToken) {
      setState("error");
      setMessage("安全確認を完了してから、もう一度お試しください。");
      return;
    }

    setState("sending");
    setMessage(null);
    try {
      const { response, body } = await withAnonymousSessionLock(async () => {
        const response = await fetch(`/api/v1/auth/email/${purpose}`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            ...(purpose === "recover" && captchaToken ? { captchaToken } : {}),
          }),
        });
        const body = await safeJson(response);
        return { response, body };
      });
      if (!response.ok) {
        setState("error");
        setMessage(
          isApiError(body)
            ? messageForApiError(body.error)
            : "メールを送信できませんでした。もう一度お試しください。",
        );
        return;
      }
      setState("code");
      setMessage("入力内容と受信メールを確認してください");
    } catch {
      setState("error");
      setMessage("メールを送信できませんでした。通信状態を確認してください。");
    } finally {
      if (recoveryChallengeRequired) {
        setCaptchaToken(null);
        setCaptchaResetKey((current) => current + 1);
      }
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) {
      return;
    }
    if (!purpose) return;
    if (!token.trim()) {
      setState("error");
      setMessage("認証コードを入力してください。");
      return;
    }

    setState("verifying");
    setMessage(null);
    onTransitionPending();
    try {
      const result = await withAnonymousSessionLock(async () => {
        const verify = () =>
          fetch("/api/v1/auth/email/verify", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: email.trim(),
              token: token.trim(),
              flow: purpose,
            }),
          }).then(async (response) => ({
            ok: response.ok,
            response,
            body: await safeJson(response),
            authContextChanged:
              response.headers.get("x-emanowa-auth-context-changed") === "1",
          }));
        return runAuthContextChange(purpose, verify, (candidate) =>
          purpose === "recover"
            ? candidate.ok || candidate.authContextChanged
            : candidate.authContextChanged,
        );
      });
      const { response, body, authContextChanged } = result;
      if (!response.ok) {
        if (authContextChanged) {
          clearPrivateSessionData();
          setEmail("");
          setToken("");
          onSignedOut();
        } else {
          onTransitionSettled();
        }
        setState("error");
        setMessage(
          isApiError(body)
            ? messageForApiError(body.error)
            : "認証コードを確認できませんでした。",
        );
        return;
      }
      setState("success");
      setMessage(
        purpose === "link"
          ? "メールでの引き継ぎ設定が完了しました。"
          : "この端末で自分の絵馬を管理できるようになりました。",
      );
      await onVerified(purpose);
    } catch (error) {
      const identityChangedWithoutCommit =
        error instanceof AuthContextTransitionError && error.identityChanged;
      const transitionStillPending =
        readAuthContextSnapshot().phase === "pending";
      if (identityChangedWithoutCommit) {
        clearPrivateSessionData();
        setEmail("");
        setToken("");
        onSignedOut();
      } else if (!transitionStillPending) {
        onTransitionSettled();
      }
      setState("error");
      setMessage(
        identityChangedWithoutCommit
          ? "本人情報は更新されました。他のタブは安全のため非表示になっています。この画面を再読み込みしてください。"
          : transitionStillPending
            ? "本人情報変更の完了を確認できませんでした。安全な復旧操作を選んでください。"
            : "認証コードを確認できませんでした。通信状態を確認してください。",
      );
    }
  }

  async function signOut(): Promise<void> {
    const warning =
      sessionKind === "anonymous"
        ? "メール連携前のゲストをログアウトすると、この絵馬を管理できなくなる可能性があります。ログアウトしますか。"
        : "この端末からログアウトしますか。";
    if (!window.confirm(warning)) return;

    setMessage(null);
    onTransitionPending();
    try {
      const result = await withAnonymousSessionLock(() =>
        runAuthContextChange(
          "signout",
          () =>
            fetch("/api/v1/auth/signout", {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }).then(async (response) => ({
              ok: response.ok,
              response,
              body: await safeJson(response),
              authContextChanged:
                response.headers.get("x-emanowa-auth-context-changed") === "1",
            })),
          (candidate) => candidate.ok || candidate.authContextChanged,
        ),
      );
      const { response, body, authContextChanged } = result;
      if (!response.ok) {
        if (authContextChanged) {
          clearPrivateSessionData();
          setEmail("");
          setToken("");
          onSignedOut();
        } else {
          onTransitionSettled();
        }
        setState("error");
        setMessage(
          isApiError(body)
            ? messageForApiError(body.error)
            : "ログアウトできませんでした。もう一度お試しください。",
        );
        return;
      }
      clearPrivateSessionData();
      setEmail("");
      setToken("");
      setState("idle");
      setMessage(
        "ログアウトしました。この端末の下書きと本人限定の表示を消去しました。",
      );
      onSignedOut();
    } catch (error) {
      const signedOutWithoutCommit =
        error instanceof AuthContextTransitionError && error.identityChanged;
      const transitionStillPending =
        readAuthContextSnapshot().phase === "pending";
      if (signedOutWithoutCommit) {
        clearPrivateSessionData();
        setEmail("");
        setToken("");
        onSignedOut();
      } else if (!transitionStillPending) {
        onTransitionSettled();
      }
      setState("error");
      setMessage(
        signedOutWithoutCommit
          ? "ログアウトしました。他のタブは安全のため非表示になっています。この画面を再読み込みしてください。"
          : transitionStillPending
            ? "ログアウト結果を確認できませんでした。安全な復旧操作を選んでください。"
            : "ログアウトできませんでした。通信状態を確認してください。",
      );
    }
  }

  if (transitionPending) {
    return (
      <section
        className="stage-card stage-card--private email-ownership"
        aria-live="polite"
        aria-busy="true"
      >
        <h2>メール認証を確認しています</h2>
        <p>入力したメールアドレスと認証コードを一時的に隠しています。</p>
      </section>
    );
  }

  return (
    <section
      className="stage-card stage-card--private email-ownership"
      id="email-link"
      aria-labelledby="email-ownership-heading"
    >
      <h2 id="email-ownership-heading">
        {sessionKind === "anonymous"
          ? "メールで引き継ぐ"
          : sessionKind === "registered"
            ? "メール連携済み"
            : "メールで復元する"}
      </h2>
      <p>
        {sessionKind === "anonymous"
          ? "別の端末でも同じ絵馬を管理するための、任意の設定です。"
          : sessionKind === "registered"
            ? "確認済みのメールを使って、別の端末からこの絵馬へ戻れます。"
            : "以前に設定したメールへ認証コードを送り、同じ絵馬へ戻ります。"}
      </p>

      {state !== "success" && purpose ? (
        <>
          <form
            className="compact-form"
            onSubmit={(event) => void requestCode(event)}
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
          >
            <div className="field">
              <label htmlFor="ownership-email">メールアドレス</label>
              <input
                id="ownership-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                disabled={
                  transitionPending ||
                  state === "sending" ||
                  state === "verifying"
                }
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {purpose === "recover" ? (
              <TurnstileChallenge
                siteKey={captchaSiteKey}
                required={captchaRequired}
                action="email-recovery"
                resetKey={captchaResetKey}
                onTokenChange={setCaptchaToken}
              />
            ) : null}
            <button
              className="button button--secondary"
              type="submit"
              disabled={
                state === "sending" ||
                state === "verifying" ||
                transitionPending ||
                (recoveryChallengeRequired && !captchaToken)
              }
            >
              {state === "sending"
                ? "送信しています…"
                : state === "code" || state === "error"
                  ? "認証コードを再送する"
                  : "認証コードを送る"}
            </button>
          </form>

          {state === "code" ||
          state === "verifying" ||
          (state === "error" && token.length > 0) ? (
            <form
              className="compact-form code-form"
              onSubmit={(event) => void verifyCode(event)}
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
            >
              <div className="field">
                <label htmlFor="ownership-token">認証コード</label>
                <input
                  id="ownership-token"
                  name="token"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={token}
                  disabled={transitionPending || state === "verifying"}
                  required
                  onChange={(event) => setToken(event.target.value)}
                />
                <p className="field__hint">
                  期限切れの場合は、上のボタンから新しいコードを送れます。
                </p>
              </div>
              <button
                className="button"
                type="submit"
                disabled={transitionPending || state === "verifying"}
              >
                {state === "verifying"
                  ? "確認しています…"
                  : "認証コードを確認する"}
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      <div className="status-stack" aria-live="polite" aria-atomic="true">
        {message ? (
          <p
            className={
              state === "error"
                ? "form-message form-message--error"
                : "form-message form-message--success"
            }
          >
            {message}
          </p>
        ) : null}
      </div>

      {sessionKind !== "none" ? (
        <div className="account-actions">
          <p className="fine-print">
            ログアウトすると本人画面を閉じ、開いているタブの下書きと非公開内容を消去します。
            {sessionKind === "anonymous"
              ? " メール連携前は、この絵馬を管理できなくなる場合があります。"
              : ""}
          </p>
          <button
            className="button button--quiet"
            type="button"
            disabled={transitionPending}
            onClick={() => void signOut()}
          >
            ログアウト
          </button>
        </div>
      ) : null}
    </section>
  );
}
