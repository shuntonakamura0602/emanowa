import Link from "next/link";

import { FEATURED_WORLD_SLUG } from "@/config/worlds";
import { getPublicRuntimeConfig } from "@/server/config";

export {
  EmaShape,
  EmptyState,
  PageIntro,
  StageCard,
  WorldBreadcrumb,
} from "./site-primitives";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="えまのわ ホーム">
          <span className="brand__mark" aria-hidden="true" />
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
  const { environment, publication, services } = getPublicRuntimeConfig();

  if (environment === "production" && publication.ready) {
    return null;
  }

  const notice =
    environment === "staging"
      ? {
          label: "検証環境の表示",
          title: "検証環境です。",
          message: services.writesAvailable
            ? "ここでの操作は公開環境の実績として扱いません。テスト用の内容だけを入力してください。"
            : "外部サービスの設定が不足しているため、保存を伴う確認は利用できません。",
        }
      : environment === "production"
        ? {
            label: "公開準備の状態",
            title: "公開準備中です。",
            message:
              "運営情報と公開設定の確認が完了していません。新しい投稿は行わないでください。",
          }
        : {
            label: "開発環境の接続状態",
            title:
              services.status === "development_demo"
                ? "開発用サンプルです。"
                : "開発環境です。",
            message:
              services.status === "ready"
                ? "ローカルの接続先へ保存します。本番の投稿としては扱いません。"
                : services.status === "development_demo"
                  ? "本番保存や実際の投稿としては扱いません。"
                  : "入力画面は確認できますが、保存と本人管理は利用できません。",
          };

  return (
    <aside className="connection-notice" aria-label={notice.label}>
      <div className="container connection-notice__inner">
        <span className="status-dot" aria-hidden="true" />
        <p>
          <strong>{notice.title}</strong> {notice.message}
        </p>
      </div>
    </aside>
  );
}

export function SiteFooter() {
  const { operations } = getPublicRuntimeConfig();

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
          {operations.contactUrl ? (
            <a href={operations.contactUrl}>お問い合わせ</a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
