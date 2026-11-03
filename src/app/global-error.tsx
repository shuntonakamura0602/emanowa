"use client";

import { useEffect } from "react";

function safeDigest(error: unknown): string {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return "unavailable";
  }
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(digest)
    ? digest
    : "unavailable";
}

const bodyStyle = {
  margin: 0,
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "#f8f1df",
  color: "#30271f",
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

const mainStyle = {
  width: "min(100%, 640px)",
  padding: "32px",
  border: "1px solid #d9c8a8",
  borderRadius: "20px",
  background: "#fffdf7",
  boxShadow: "0 16px 40px rgb(63 44 24 / 12%)",
} as const;

const buttonStyle = {
  minWidth: "44px",
  minHeight: "44px",
  padding: "10px 18px",
  border: 0,
  borderRadius: "999px",
  background: "#83522f",
  color: "#fff",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} as const;

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest = safeDigest(error);
  useEffect(() => {
    console.error(`[emanowa:global-error] digest=${digest}`);
  }, [digest]);

  return (
    <html lang="ja">
      <head>
        <title>一時的な問題が発生しました | えまのわ</title>
      </head>
      <body style={bodyStyle}>
        <main style={mainStyle} aria-labelledby="global-error-title">
          <p>えまのわ</p>
          <h1 id="global-error-title">画面を読み込めませんでした</h1>
          <p>
            通信やサービスの状態を確認しています。入力中の画面は閉じず、少し待ってからもう一度お試しください。
          </p>
          <button style={buttonStyle} type="button" onClick={() => retry()}>
            もう一度読み込む
          </button>
        </main>
      </body>
    </html>
  );
}
