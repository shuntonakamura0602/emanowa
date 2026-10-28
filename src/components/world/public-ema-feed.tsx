"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  publicEmaListResponseSchema,
  type Category,
  type PublicEma,
} from "@/domain/schemas";

import { CATEGORY_OPTIONS } from "../ema/ui-contracts";
import {
  PUBLIC_FEED_PAGE_SIZE,
  PUBLIC_FEED_REFRESH_MS,
  createPublicEmaPage,
} from "./map-contracts";

type FeedState = "loading" | "ready" | "error";

export function PublicEmaFeed({
  worldSlug,
  onFocus,
  onRandom,
  randomPending,
}: {
  worldSlug: string;
  onFocus: (ema: PublicEma) => void;
  onRandom: () => void;
  randomPending: boolean;
}) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [items, setItems] = useState<PublicEma[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<FeedState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const currentPageCursorRef = useRef<string | null>(null);
  const pageNumberRef = useRef(1);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(
    async (
      selectedCategory: Category | "all",
      cursor: string | null,
      signal: AbortSignal,
      generation: number,
      targetPageNumber: number,
    ): Promise<void> => {
      const query = new URLSearchParams({
        limit: String(PUBLIC_FEED_PAGE_SIZE),
      });
      if (selectedCategory !== "all") {
        query.set("category", selectedCategory);
      }
      if (cursor) query.set("cursor", cursor);

      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(worldSlug)}/emas?${query.toString()}`,
        {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal,
        },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error("公開絵馬を読み込めませんでした。");
      const parsed = publicEmaListResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.items.some((item) => item.worldSlug !== worldSlug)
      ) {
        throw new Error("公開絵馬の応答を確認できませんでした。");
      }
      if (requestGenerationRef.current !== generation) return;

      const page = createPublicEmaPage(
        parsed.data.items,
        cursor,
        parsed.data.nextCursor,
        targetPageNumber,
      );
      currentPageCursorRef.current = page.currentPageCursor;
      pageNumberRef.current = page.pageNumber;
      setItems(page.items);
      setPageNumber(page.pageNumber);
      setNextCursor(page.nextCursor);
      setMessage(null);
    },
    [worldSlug],
  );

  const startPageLoad = useCallback(
    (cursor: string | null, targetPageNumber: number): void => {
      activeControllerRef.current?.abort();
      requestGenerationRef.current += 1;
      const generation = requestGenerationRef.current;
      const controller = new AbortController();
      activeControllerRef.current = controller;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setState("loading");
      setItems([]);
      setNextCursor(null);
      setMessage(null);
      void loadPage(
        category,
        cursor,
        controller.signal,
        generation,
        targetPageNumber,
      )
        .then(() => {
          if (requestGenerationRef.current === generation) setState("ready");
        })
        .catch((error: unknown) => {
          if (
            requestGenerationRef.current === generation &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setState("error");
            setMessage(
              error instanceof Error
                ? error.message
                : "公開絵馬を読み込めませんでした。",
            );
          }
        });
    },
    [category, loadPage],
  );

  const reload = useCallback(() => startPageLoad(null, 1), [startPageLoad]);
  const refreshCurrentPage = useCallback(
    () => startPageLoad(currentPageCursorRef.current, pageNumberRef.current),
    [startPageLoad],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") reload();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestGenerationRef.current += 1;
      activeControllerRef.current?.abort();
    };
  }, [reload]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !loadingMoreRef.current) {
        refreshCurrentPage();
      }
    }, PUBLIC_FEED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshCurrentPage]);

  useEffect(() => {
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        reload();
      } else {
        requestGenerationRef.current += 1;
        activeControllerRef.current?.abort();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [reload]);

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMoreRef.current) return;
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage(
        category,
        nextCursor,
        controller.signal,
        generation,
        pageNumberRef.current + 1,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage("続きを読み込めませんでした。もう一度お試しください。");
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  return (
    <section
      className="world-panel list-panel"
      id="ema-list"
      aria-labelledby="ema-list-title"
    >
      <header className="list-panel__header">
        <div>
          <p className="eyebrow">一覧による代替表示</p>
          <h2 id="ema-list-title">新しい公開絵馬</h2>
        </div>
        <button
          className="button button--quiet"
          type="button"
          onClick={onRandom}
          disabled={randomPending}
        >
          {randomPending ? "探しています…" : "ランダムに見る"}
        </button>
      </header>

      <div className="feed-filter">
        <label htmlFor="ema-category-filter">カテゴリー</label>
        <select
          id="ema-category-filter"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as Category | "all")
          }
        >
          <option value="all">すべて</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {state === "loading" ? (
        <p className="map-status" role="status">
          公開絵馬を読み込んでいます…
        </p>
      ) : null}

      {state === "error" ? (
        <div className="map-error" role="alert">
          <p>{message ?? "公開絵馬を読み込めませんでした。"}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={reload}
          >
            もう一度読み込む
          </button>
        </div>
      ) : null}

      {state === "ready" && items.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <span className="empty-state__symbol" aria-hidden="true">
            絵
          </span>
          <h3>
            {pageNumber === 1
              ? "このカテゴリーの公開絵馬はまだありません"
              : "このページに表示できる公開絵馬はありません"}
          </h3>
          <p>
            {pageNumber === 1
              ? "ほかのカテゴリーを見るか、最初の願いを掛けてみませんか。"
              : "次のページへ進むか、先頭へ戻ってください。"}
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="ema-feed" aria-label="公開絵馬の一覧">
          {items.map((ema) => (
            <li className="ema-feed__item" key={ema.publicId}>
              <article>
                <p className="ema-feed__meta">
                  <span>{categoryLabel(ema.category)}</span>
                  <span>場所 {ema.slotNumber.toLocaleString("ja-JP")}番</span>
                </p>
                <h3>{ema.nickname ?? "ななしさん"}</h3>
                <p className="ema-feed__message">
                  {ema.messageText ?? "ひみつの願い"}
                </p>
                <div className="ema-feed__actions">
                  <Link
                    className="button button--secondary"
                    href={`/w/${encodeURIComponent(worldSlug)}/e/${ema.publicId}`}
                  >
                    絵馬を読む
                  </Link>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => onFocus(ema)}
                  >
                    地図で見る
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {state === "ready" && items.length > 0 ? (
        <p className="fine-print" aria-live="polite">
          ページ {pageNumber.toLocaleString("ja-JP")}・現在
          {items.length.toLocaleString("ja-JP")}
          件を表示しています。1ページは最大
          {PUBLIC_FEED_PAGE_SIZE.toLocaleString("ja-JP")}件です。
        </p>
      ) : null}

      {message && state === "ready" ? (
        <p className="form-message form-message--error" role="alert">
          {message}
        </p>
      ) : null}

      {nextCursor || pageNumber > 1 ? (
        <div className="feed-more">
          {pageNumber > 1 ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={reload}
            >
              先頭へ戻る
            </button>
          ) : null}
          {nextCursor ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "読み込んでいます…" : "次のページ"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function categoryLabel(category: Category): string {
  return (
    CATEGORY_OPTIONS.find((option) => option.value === category)?.label ??
    "その他"
  );
}
