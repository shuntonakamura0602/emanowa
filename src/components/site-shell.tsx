import Link from "next/link";
import type { ReactNode } from "react";

import { FEATURED_WORLD_SLUG } from "@/config/worlds";
import { getPublicRuntimeConfig } from "@/server/config";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="えまのわ ホーム">
          <span className="brand__mark" aria-hidden="true">
            わ
          </span>
          <span>えまのわ</span>
        </Link>
        <nav className="site-nav" aria-label="主なメニュー">
          <Link href={"/w/" + FEATURED_WORLD_SLUG}>絵馬を眺める</Link>
          <Link href="/me">自分の絵馬</Link>
          <Link href="/about">えまのわについて</Link>
        </nav>
      </div>
    </header>
  );
}

export function ConnectionNotice() {
  const { services } = getPublicRuntimeConfig();
  const connectionMessage =
    services.status === "ready"
      ? "認証・保存・本人管理を利用できます。Canvas地図は次の段階で実装します。"
      : services.status === "development_demo"
        ? "開発用サンプルが選択されています。本番保存や実際の投稿としては扱いません。"
        : "外部サービスは未接続です。入力画面は確認できますが、保存と本人管理は利用できません。";

  return (
    <aside className="connection-notice" aria-label="開発環境の接続状態">
      <div className="container connection-notice__inner">
        <span className="status-dot" aria-hidden="true" />
        <p>
          <strong>段階C：絵馬の作成と本人管理。</strong> {connectionMessage}
        </p>
      </div>
    </aside>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <p className="site-footer__brand">えまのわ</p>
          <p className="muted">みんなの願いが集まる、オンライン絵馬。</p>
        </div>
        <nav className="footer-nav" aria-label="補助メニュー">
          <Link href="/about">使い方</Link>
          <Link href="/terms">利用条件</Link>
          <Link href="/privacy">プライバシー</Link>
        </nav>
      </div>
    </footer>
  );
}

export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="page-intro">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      <div className="page-intro__copy">{children}</div>
    </header>
  );
}

export function StageCard({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "warm" | "private";
}) {
  return (
    <section className={"stage-card stage-card--" + tone}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function WorldBreadcrumb({
  worldSlug,
  current,
}: {
  worldSlug: string;
  current: string;
}) {
  const safeWorld = encodeURIComponent(worldSlug);

  return (
    <nav className="breadcrumb" aria-label="現在位置">
      <Link href="/">ホーム</Link>
      <span aria-hidden="true">/</span>
      <Link href={"/w/" + safeWorld}>{worldSlug}年のえまのわ</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{current}</span>
    </nav>
  );
}

export function EmaShape({
  label = "絵馬のプレビュー",
  children,
}: {
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ema-shape" role="img" aria-label={label}>
      <span className="ema-shape__cord" aria-hidden="true" />
      <div className="ema-shape__face">
        {children ?? (
          <span className="ema-shape__placeholder">あなたの願い</span>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__symbol" aria-hidden="true">
        ◯
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
