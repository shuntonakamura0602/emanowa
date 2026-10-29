"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmaShape, PageIntro, StageCard } from "@/components/site-primitives";
import { worldLocationHref } from "@/components/world/map-contracts";
import { publicEmaSchema, type PublicEma } from "@/domain/schemas";

import { EmaSharePanel } from "./ema-share-panel";
import { EmaReportPanel } from "./ema-report-panel";

const DETAIL_REFRESH_MILLISECONDS = 30_000;

const CATEGORY_LABELS = {
  family: "家族",
  health: "健康",
  study: "学び・合格",
  work: "仕事",
  love: "恋愛・ご縁",
  challenge: "挑戦",
  other: "その他",
} as const;

function publicEmaFromBody(value: unknown): PublicEma | null {
  if (!value || typeof value !== "object" || !("ema" in value)) return null;
  const parsed = publicEmaSchema.safeParse((value as { ema: unknown }).ema);
  return parsed.success ? parsed.data : null;
}

export function EmaDetailLive({
  initialEma,
  configuredOrigin,
  captchaSiteKey,
  captchaRequired,
}: {
  initialEma: PublicEma;
  configuredOrigin: string | null;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
}) {
  const [ema, setEma] = useState<PublicEma | null>(initialEma);
  const [refreshMessage, setRefreshMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(initialEma.worldSlug)}/emas/${encodeURIComponent(initialEma.publicId)}`,
        {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        },
      );
      if (response.status === 404) {
        setEma(null);
        setRefreshMessage("");
        return;
      }
      if (!response.ok) {
        throw new Error("refresh failed");
      }
      const body = (await response.json()) as unknown;
      const current = publicEmaFromBody(body);
      if (!current || current.publicId !== initialEma.publicId) {
        throw new Error("invalid public ema response");
      }
      setEma(current);
      setRefreshMessage("");
    } catch {
      if (controller.signal.aborted) return;
      setRefreshMessage(
        "最新の公開状態を確認できませんでした。表示内容は再確認できるまで共有しないでください。",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [initialEma.publicId, initialEma.worldSlug]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, DETAIL_REFRESH_MILLISECONDS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestRef.current?.abort();
    };
  }, [refresh]);

  if (!ema) {
    return (
      <>
        <PageIntro
          eyebrow={initialEma.worldSlug + "年"}
          title="絵馬を表示できません"
        >
          <p>
            この絵馬は削除されたか、現在は公開されていません。以前の本文はこの画面に保持していません。
          </p>
        </PageIntro>
        <StageCard title="この年のえまのわを見る" tone="private">
          <p>地図や公開一覧から、現在見ることのできる絵馬を探せます。</p>
          <Link
            className="button button--secondary"
            href={`/w/${initialEma.worldSlug}`}
          >
            {initialEma.worldSlug}年の地図へ
          </Link>
        </StageCard>
      </>
    );
  }

  return (
    <>
      <PageIntro eyebrow={ema.worldSlug + "年"} title="絵馬の詳細">
        <p>
          {ema.visibility === "unlisted"
            ? "この絵馬は、リンクを知っている人だけが開けます。リンクは転送されることがあります。"
            : "みんなの願いが集まる、えまのわの絵馬です。"}
        </p>
        {refreshMessage ? (
          <p className="form-message form-message--error" role="status">
            {refreshMessage}
          </p>
        ) : null}
      </PageIntro>

      <div className="detail-layout">
        <StageCard title={ema.nickname ?? "ななしさん"} tone="warm">
          <EmaShape label={`${ema.nickname ?? "ななしさん"}の絵馬`}>
            <span>
              {ema.messageText === null ? "ひみつの願い" : ema.messageText}
            </span>
          </EmaShape>
          <dl className="detail-list">
            <div>
              <dt>願いの種類</dt>
              <dd>{CATEGORY_LABELS[ema.category]}</dd>
            </div>
            <div>
              <dt>場所</dt>
              <dd>{ema.slotNumber.toLocaleString("ja-JP")}番</dd>
            </div>
          </dl>
        </StageCard>

        <div className="card-grid">
          <StageCard title="できること">
            <p>
              この絵馬が掛かっている場所を地図で確認したり、内容を確認してから共有できます。
            </p>
            <div className="action-row">
              <EmaSharePanel ema={ema} configuredOrigin={configuredOrigin} />
              <EmaReportPanel
                worldSlug={ema.worldSlug}
                publicId={ema.publicId}
                captchaSiteKey={captchaSiteKey}
                captchaRequired={captchaRequired}
              />
              <Link
                className="button button--secondary"
                href={worldLocationHref(ema.worldSlug, ema.x, ema.y)}
              >
                地図で見る
              </Link>
              <Link className="button button--quiet" href="/me">
                本人管理画面
              </Link>
            </div>
          </StageCard>
          <StageCard title="公開範囲について" tone="private">
            <p>
              {ema.messageVisibility === "owner_only"
                ? "願いの本文は本人だけに保存され、この公開ページや共有画像には渡していません。表示名・分類・場所は公開情報です。"
                : "この願いの本文と表示名は、現在の公開設定に従って表示されています。"}
            </p>
          </StageCard>
        </div>
      </div>
    </>
  );
}
