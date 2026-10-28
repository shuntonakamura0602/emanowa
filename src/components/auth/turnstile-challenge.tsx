"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileOptions = {
  sitekey: string;
  action: string;
  theme: "auto";
  callback(token: string): void;
  "expired-callback"(): void;
  "error-callback"(errorCode: string): void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type ChallengeState = "loading" | "waiting" | "verified" | "expired" | "error";

export type TurnstileChallengeProps = {
  siteKey: string | null;
  required: boolean;
  action: "anonymous-auth" | "email-recovery";
  /** Increment after every Auth request so a consumed token is never reused. */
  resetKey?: number;
  onTokenChange(token: string | null): void;
};

/**
 * Loads Cloudflare's official explicit-render widget only on forms that need
 * it. The opaque token is kept in React state by the caller and is never
 * persisted to storage, a URL, or server-rendered markup.
 */
export function TurnstileChallenge({
  siteKey,
  required,
  action,
  resetKey = 0,
  onTokenChange,
}: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const [state, setState] = useState<ChallengeState>("loading");

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    if (!required || !siteKey || !scriptReady) return;
    const container = containerRef.current;
    const turnstile = window.turnstile;
    if (!container || !turnstile) return;

    setState("waiting");
    onTokenChangeRef.current(null);
    const widgetId = turnstile.render(container, {
      sitekey: siteKey,
      action,
      theme: "auto",
      callback(token) {
        const normalized = token.trim();
        onTokenChangeRef.current(normalized || null);
        setState(normalized ? "verified" : "error");
      },
      "expired-callback"() {
        onTokenChangeRef.current(null);
        setState("expired");
      },
      "error-callback"() {
        onTokenChangeRef.current(null);
        setState("error");
      },
    });

    return () => {
      turnstile.remove(widgetId);
      onTokenChangeRef.current(null);
    };
  }, [action, required, resetKey, scriptReady, siteKey]);

  if (!required) return null;

  if (!siteKey) {
    return (
      <p className="form-message form-message--error" role="alert">
        安全確認の設定が完了していないため、現在は送信できません。
      </p>
    );
  }

  return (
    <div className="captcha-challenge" aria-label="ボットではないことの確認">
      <Script
        id="emanowa-turnstile-script"
        src={TURNSTILE_SCRIPT_URL}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => {
          onTokenChangeRef.current(null);
          setState("error");
        }}
      />
      <div ref={containerRef} />
      <p className="field-hint" role="status" aria-live="polite">
        {state === "verified"
          ? "安全確認が完了しました。"
          : state === "expired"
            ? "安全確認の有効期限が切れました。もう一度確認してください。"
            : state === "error"
              ? "安全確認を読み込めませんでした。通信状態を確認してください。"
              : "安全確認を読み込んでいます。"}
      </p>
    </div>
  );
}
