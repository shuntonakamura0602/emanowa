"use client";

import { useRef, useState } from "react";

import { measurePublicEvent } from "@/components/analytics/public-measurement";
import type { PublicEma } from "@/domain/schemas";

import { EmaPreview } from "./ema-preview";
import {
  buildEmaShareLinks,
  shareImageFilename,
  type EmaShareLinks,
} from "./share-contracts";

type CopyFallback = { label: string; url: string } | null;

function initialShareLinks(
  origin: string | null,
  worldSlug: string,
  publicId: string,
): EmaShareLinks | null {
  if (!origin) return null;
  try {
    return buildEmaShareLinks(origin, worldSlug, publicId);
  } catch {
    return null;
  }
}

export function EmaSharePanel({
  ema,
  configuredOrigin,
}: {
  ema: PublicEma;
  configuredOrigin: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState<EmaShareLinks | null>(() =>
    initialShareLinks(configuredOrigin, ema.worldSlug, ema.publicId),
  );
  const [status, setStatus] = useState("");
  const [copyFallback, setCopyFallback] = useState<CopyFallback>(null);
  const [savingImage, setSavingImage] = useState(false);

  function openShareSheet(): void {
    if (!links) {
      setLinks(
        initialShareLinks(window.location.origin, ema.worldSlug, ema.publicId),
      );
    }
    setStatus("");
    setCopyFallback(null);
    dialogRef.current?.showModal();
    measurePublicEvent({ name: "share_opened", worldSlug: ema.worldSlug });
  }

  function closeShareSheet(): void {
    dialogRef.current?.close();
  }

  function showCopyFallback(label: string, url: string): void {
    setCopyFallback({ label, url });
    setStatus(
      "自動でコピーできませんでした。表示されたURLを選択してコピーしてください。",
    );
    requestAnimationFrame(() => {
      fallbackInputRef.current?.focus();
      fallbackInputRef.current?.select();
    });
  }

  async function copyUrl(
    label: string,
    url: string,
    successMessage: string,
    linkKind: "public" | "invite",
  ): Promise<void> {
    setCopyFallback(null);
    if (!navigator.clipboard?.writeText) {
      showCopyFallback(label, url);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus(successMessage);
      measurePublicEvent({
        name: "link_copied",
        worldSlug: ema.worldSlug,
        linkKind,
      });
    } catch {
      showCopyFallback(label, url);
    }
  }

  async function saveImage(): Promise<void> {
    if (!links || savingImage) return;
    setSavingImage(true);
    setStatus("共有画像を準備しています。");
    try {
      const response = await fetch(links.imageUrl, {
        cache: "no-store",
        credentials: "omit",
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.startsWith("image/png")
      ) {
        throw new Error("image unavailable");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = shareImageFilename(ema.worldSlug, ema.publicId);
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setStatus(
        "共有画像の保存を開始しました。端末のダウンロード先をご確認ください。",
      );
      measurePublicEvent({
        name: "share_image_downloaded",
        worldSlug: ema.worldSlug,
      });
    } catch {
      setStatus(
        "共有画像を保存できませんでした。リンクのコピーやX・LINEでの共有は引き続き利用できます。",
      );
    } finally {
      setSavingImage(false);
    }
  }

  function recordShareClick(
    channel: "x" | "line",
    linkKind: "public" | "invite",
  ): void {
    setStatus(
      channel === "x"
        ? "Xの投稿画面を開きました。投稿の確定はXの画面で行ってください。"
        : "LINEの送信画面を開きました。送信の確定はLINEの画面で行ってください。",
    );
    measurePublicEvent({
      name: "share_clicked",
      worldSlug: ema.worldSlug,
      channel,
      linkKind,
    });
  }

  return (
    <>
      <button className="button" type="button" onClick={openShareSheet}>
        この絵馬を共有する
      </button>

      <dialog
        ref={dialogRef}
        className="share-dialog"
        aria-labelledby="share-dialog-title"
        onClose={() => {
          setStatus("");
          setCopyFallback(null);
        }}
      >
        <div className="share-dialog__header">
          <div>
            <p className="eyebrow">共有する内容の確認</p>
            <h2 id="share-dialog-title">この絵馬を共有する</h2>
          </div>
          <button
            className="share-dialog__close"
            type="button"
            aria-label="共有画面を閉じる"
            onClick={closeShareSheet}
          >
            ×
          </button>
        </div>

        {links ? (
          <div className="share-dialog__body">
            <section
              className="share-preview"
              aria-labelledby="share-preview-title"
            >
              <div>
                <h3 id="share-preview-title">共有カードのプレビュー</h3>
                <p className="fine-print">
                  実際のSNS表示は各サービスの仕様により異なります。
                </p>
                <EmaPreview
                  wishText={ema.messageText ?? ""}
                  nickname={ema.nickname}
                  category={ema.category}
                  visibility={ema.visibility}
                  messageVisibility={ema.messageVisibility}
                  surface="image"
                  slotNumber={ema.slotNumber}
                />
              </div>
              <div>
                <h3>共有する文章</h3>
                <p className="share-title">
                  <strong>タイトル：</strong>
                  {ema.nickname ?? "ななしさん"}の絵馬
                </p>
                <pre className="share-copy">{links.normalText}</pre>
                <label className="share-url-field">
                  公開URL
                  <input
                    readOnly
                    value={links.publicUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              </div>
            </section>

            <div className="share-actions" aria-label="共有方法">
              <a
                className="button"
                href={links.xUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordShareClick("x", "public")}
              >
                Xで共有
              </a>
              <a
                className="button button--secondary"
                href={links.lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordShareClick("line", "public")}
              >
                LINEで送る
              </a>
              <button
                className="button button--quiet"
                type="button"
                onClick={() =>
                  void copyUrl(
                    "公開URL",
                    links.publicUrl,
                    "リンクをコピーしました",
                    "public",
                  )
                }
              >
                リンクをコピー
              </button>
              <button
                className="button button--quiet"
                type="button"
                disabled={savingImage}
                onClick={() => void saveImage()}
              >
                {savingImage ? "画像を準備中" : "画像を保存"}
              </button>
            </div>

            <section
              className="share-invite"
              aria-labelledby="invite-share-title"
            >
              <p className="eyebrow">近くへの招待</p>
              <h3 id="invite-share-title">友達にも近くに掛けてもらう</h3>
              <p>
                招待リンクは場所を予約しません。友達が保存するときに、空きをもう一度確認します。
              </p>
              <pre className="share-copy">{links.inviteText}</pre>
              <div className="share-actions">
                <a
                  className="button button--secondary"
                  href={links.inviteLineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => recordShareClick("line", "invite")}
                >
                  LINEで招待文を送る
                </a>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() =>
                    void copyUrl(
                      "招待URL",
                      links.inviteUrl,
                      "招待リンクをコピーしました",
                      "invite",
                    )
                  }
                >
                  招待リンクをコピー
                </button>
              </div>
            </section>

            {copyFallback ? (
              <label className="share-fallback">
                {copyFallback.label}を選択してコピー
                <input
                  ref={fallbackInputRef}
                  readOnly
                  value={copyFallback.url}
                  onClick={(event) => event.currentTarget.select()}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            ) : null}

            <p className="share-status" aria-live="polite" aria-atomic="true">
              {status}
            </p>
          </div>
        ) : (
          <div className="share-dialog__body">
            <p className="form-message form-message--error" role="status">
              共有URLを準備できませんでした。ページを再読み込みして、もう一度お試しください。
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}
