import { PageIntro } from "@/components/site-shell";

export const metadata = {
  title: "プライバシー",
};

export default function PrivacyPage() {
  return (
    <section className="container page-section">
      <PageIntro eyebrow="公開準備中" title="プライバシーについて">
        <p>
          このページは段階Aの説明です。採用する外部サービスと保存期間を確定し、実際の挙動に合わせて正式な文面を整えます。
        </p>
      </PageIntro>

      <div className="policy-stack">
        <section className="policy-section">
          <h2>願いの本文</h2>
          <p>
            本文を「自分だけ」にした場合、公開API、HTML、共有画像、メタ情報へ含めない設計にします。入力内容を外部AIへ送信しません。
          </p>
        </section>
        <section className="policy-section">
          <h2>認証と復元</h2>
          <p>
            閲覧だけでは匿名アカウントを作りません。投稿時の所有権と、任意で連携するメールは公開データから分離します。
          </p>
        </section>
        <section className="policy-section">
          <h2>計測とログ</h2>
          <p>
            願い本文、表示名、メールアドレス、認証トークン、限定URL全体を解析イベントへ含めない方針です。
          </p>
        </section>
      </div>
    </section>
  );
}
