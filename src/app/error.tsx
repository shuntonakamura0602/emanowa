"use client";

import Link from "next/link";
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

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest = safeDigest(error);
  useEffect(() => {
    console.error(`[emanowa:error-boundary] digest=${digest}`);
  }, [digest]);

  return (
    <>
      <title>一時的な問題が発生しました | えまのわ</title>
      <section className="container page-section" aria-labelledby="error-title">
        <div
          className="stage-card stage-card--private state-panel"
          role="alert"
        >
          <p className="eyebrow">一時的な問題が発生しました</p>
          <h1 id="error-title">画面を読み込めませんでした</h1>
          <p>
            入力中の内容がある場合はこの画面を閉じず、通信が戻ってからもう一度お試しください。成功したことを確認できるまでは、同じ内容で再試行できます。
          </p>
          <div className="action-row">
            <button className="button" type="button" onClick={() => retry()}>
              もう一度読み込む
            </button>
            <Link className="button button--secondary" href="/w/2027">
              地図と一覧へ
            </Link>
            <Link className="button button--quiet" href="/me">
              本人管理を確認
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
