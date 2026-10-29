import Link from "next/link";
import type { ReactNode } from "react";

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
