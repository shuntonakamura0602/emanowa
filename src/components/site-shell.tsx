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
      ? "地図・一覧・投稿・本人管理・共有・近くへの招待を利用できます。通報と運用機能は後続の段階で追加します。"
      : services.status === "development_demo"
        ? "開発用サンプルが選択されています。本番保存や実際の投稿としては扱いません。"
        : "外部サービスは未接続です。入力画面は確認できますが、保存と本人管理は利用できません。";

  return (
    <aside className="connection-notice" aria-label="開発環境の接続状態">
      <div className="container connection-notice__inner">
        <span className="status-dot" aria-hidden="true" />
        <p>
          <strong>段階E：共有と近くへの招待。</strong> {connectionMessage}
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
