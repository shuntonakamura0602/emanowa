"use client";

import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  firstVerifiedTotpFactorId,
  normalizeTotpCode,
  totpQrDataUrl,
} from "./mfa-contracts";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type MfaState =
  | "checking"
  | "needs_enrollment"
  | "enrolling"
  | "challenge"
  | "verifying"
  | "success"
  | "error";

export function AdminMfaSetup({
  supabaseUrl,
  publishableKey,
}: {
  supabaseUrl: string;
  publishableKey: string;
}) {
  const client = useMemo(
    () => createBrowserClient(supabaseUrl, publishableKey),
    [publishableKey, supabaseUrl],
  );
  const [state, setState] = useState<MfaState>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const checkFactors = useCallback(
    async (isCurrent: () => boolean = () => true): Promise<void> => {
      setState("checking");
      setMessage(null);
      const { data, error } = await client.auth.mfa.listFactors();
      if (!isCurrent()) return;
      if (error) {
        setState("error");
        setMessage(
          "MFAの登録状態を確認できませんでした。時間をおいて再試行してください。",
        );
        return;
      }
      const verifiedId = firstVerifiedTotpFactorId(data.all);
      setFactorId(verifiedId);
      setState(verifiedId ? "challenge" : "needs_enrollment");
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) void checkFactors(() => active);
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [checkFactors]);

  async function enroll(): Promise<void> {
    setState("enrolling");
    setMessage(null);
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `えまのわ運営-${crypto.randomUUID().slice(0, 8)}`,
      issuer: "えまのわ",
    });
    if (error) {
      setState("error");
      setMessage(
        "認証アプリの設定を開始できませんでした。SupabaseのTOTP設定を確認してください。",
      );
      return;
    }
    setFactorId(data.id);
    setEnrollment({
      factorId: data.id,
      qrCode: totpQrDataUrl(data.totp.qr_code),
      secret: data.totp.secret,
    });
    setState("challenge");
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedCode = normalizeTotpCode(code);
    if (!normalizedCode) {
      setMessage("認証アプリに表示された6桁のコードを入力してください。");
      return;
    }
    const activeFactorId = enrollment?.factorId ?? factorId;
    if (!activeFactorId) {
      setState("error");
      setMessage("MFA factorを確認できません。設定をやり直してください。");
      return;
    }

    setState("verifying");
    setMessage(null);
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId: activeFactorId,
      code: normalizedCode,
    });
    if (error) {
      setState("challenge");
      setMessage(
        "コードを確認できませんでした。新しい6桁コードでもう一度お試しください。",
      );
      return;
    }

    setCode("");
    setEnrollment(null);
    setFactorId(null);
    setState("success");
    setMessage("MFA認証が完了しました。管理権限を再確認します。");
    window.location.reload();
  }

  return (
    <section className="form-card" aria-labelledby="admin-mfa-heading">
      <p className="eyebrow">追加認証</p>
      <h2 id="admin-mfa-heading">認証アプリでMFAを完了する</h2>
      <p className="muted">
        管理画面は確認済みメールに加えて、TOTP認証を完了したセッションだけが利用できます。
      </p>

      {state === "checking" ? <p>登録済みの認証器を確認しています…</p> : null}
      {state === "needs_enrollment" ? (
        <button type="button" className="button" onClick={() => void enroll()}>
          認証アプリを設定する
        </button>
      ) : null}
      {state === "error" ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void checkFactors()}
        >
          登録状態を再確認する
        </button>
      ) : null}
      {state === "enrolling" ? <p>安全な登録情報を作成しています…</p> : null}

      {enrollment ? (
        <div className="state-panel">
          <h3>QRコードを認証アプリで読み取る</h3>
          <Image
            src={enrollment.qrCode}
            width={240}
            height={240}
            unoptimized
            alt="認証アプリ登録用QRコード"
          />
          <p className="fine-print">
            読み取れない場合は、次の秘密鍵を認証アプリへ手動入力してください。この画面を閉じる前に登録を完了してください。
          </p>
          <label className="field" htmlFor="admin-mfa-secret">
            TOTP秘密鍵
            <input
              id="admin-mfa-secret"
              type="text"
              readOnly
              value={enrollment.secret}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      ) : null}

      {state === "challenge" || state === "verifying" ? (
        <form onSubmit={(event) => void verify(event)}>
          <div className="field">
            <label htmlFor="admin-mfa-code">6桁の認証コード</label>
            <input
              id="admin-mfa-code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={state === "verifying"}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="button"
            disabled={state === "verifying"}
          >
            {state === "verifying" ? "確認しています…" : "MFAを確認する"}
          </button>
        </form>
      ) : null}

      <div className="status-stack" aria-live="polite" aria-atomic="true">
        {message ? (
          <p
            className={
              state === "success"
                ? "form-message form-message--success"
                : "form-message form-message--error"
            }
          >
            {message}
          </p>
        ) : null}
      </div>
      <p className="fine-print">
        QRコード、秘密鍵、6桁コード、challenge情報はURL・ブラウザー保存領域・ログ・計測へ保存しません。
      </p>
    </section>
  );
}
