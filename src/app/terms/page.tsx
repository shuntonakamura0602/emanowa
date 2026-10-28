import { PageIntro } from "@/components/site-shell";

export const metadata = {
  title: "利用条件",
};

export default function TermsPage() {
  return (
    <section className="container page-section">
      <PageIntro eyebrow="公開準備中" title="利用条件">
        <p>
          これは公開前の暫定文面です。運営者情報、問い合わせ先、公開日、保存期間を確定してから正式な利用条件を掲示します。
        </p>
      </PageIntro>

      <div className="policy-stack">
        <section className="policy-section">
          <h2>利用者の投稿</h2>
          <p>
            願いと表示名はプレーンテキストとして扱います。個人情報や、他の人を傷つける内容を書かないでください。
          </p>
        </section>
        <section className="policy-section">
          <h2>公開範囲</h2>
          <p>
            「リンクを知っている人に見せる」は、ログインで保護された非公開保管ではありません。受け取った人がリンクを他の人へ渡せます。
          </p>
        </section>
        <section className="policy-section">
          <h2>削除と共有先</h2>
          <p>
            自サービス上の新しい応答からは削除した内容を返しませんが、共有先のSNSや、他の人が保存した画像まで回収できるとは約束しません。
          </p>
        </section>
      </div>
    </section>
  );
}
