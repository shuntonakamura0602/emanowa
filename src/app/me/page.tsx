import Link from "next/link";

import { EmptyState, PageIntro, StageCard } from "@/components/site-shell";

export default function MePage() {
  return (
    <section className="container page-section">
      <PageIntro eyebrow="本人管理" title="自分の絵馬">
        <p>
          閲覧だけでは匿名アカウントを作りません。投稿を始めるときにだけ、所有権を準備します。
        </p>
      </PageIntro>

      <div className="card-grid">
        <StageCard title="所有する絵馬">
          <EmptyState title="本人用データは未接続です">
            セッションを検証できる段階まで、絵馬がないとは断定せず、他の利用者の情報も表示しません。
          </EmptyState>
          <Link className="button button--secondary" href="/">
            開催中の年を見る
          </Link>
        </StageCard>
        <StageCard title="メールで引き継ぐ" tone="private">
          <p>
            投稿後に任意で設定できる復元手段です。確認が完了する前に、引き継ぎ済みとは表示しません。
          </p>
          <button className="button" type="button" disabled>
            メール連携を設定する
          </button>
          <p className="fine-print">認証サービス未接続のため利用できません。</p>
        </StageCard>
      </div>
    </section>
  );
}
