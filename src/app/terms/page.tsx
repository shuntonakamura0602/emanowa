import { PageIntro } from "@/components/site-shell";
import { getPublicRuntimeConfig } from "@/server/config";

export const metadata = {
  title: "利用条件",
};

function formatPolicyDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export default function TermsPage() {
  const { operations, publication } = getPublicRuntimeConfig();
  const effectiveDate = publication.policyEffectiveDate;

  return (
    <section className="container page-section">
      <PageIntro
        eyebrow={
          publication.ready && effectiveDate
            ? `適用日 ${formatPolicyDate(effectiveDate)}`
            : "公開準備中"
        }
        title="利用条件"
      >
        {publication.ready ? (
          <p>
            えまのわを利用するときの公開範囲、投稿、削除、問い合わせの条件を説明します。
          </p>
        ) : (
          <p>
            これは公開前の暫定文面です。実際の運営情報、適用日、保存方針の確認が完了するまで公開準備中として扱います。
          </p>
        )}
      </PageIntro>

      <div className="policy-stack">
        <section className="policy-section">
          <h2>サービスの位置付け</h2>
          <p>
            えまのわは、特定の神社・寺院・宗教団体による参拝や祈祷ではなく、利用者が願いを投稿して眺める独立した参加型サービスです。
          </p>
        </section>
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
          <h2>保存と削除</h2>
          {publication.retention.content ? (
            <p>{publication.retention.content}</p>
          ) : (
            <p>
              投稿内容の保存期間は公開準備中です。期間を確定せずに永久保存を約束することはありません。
            </p>
          )}
          <p>
            本人確認後に削除すると、公開ページと稼働DBの本文・表示名から除きます。バックアップやログの扱いはプライバシー説明に掲示します。
          </p>
        </section>
        <section className="policy-section">
          <h2>削除と共有先</h2>
          <p>
            自サービス上の新しい応答からは削除した内容を返しませんが、共有先のSNSや、他の人が保存した画像まで回収できるとは約束しません。
          </p>
        </section>
        <section className="policy-section">
          <h2>運営と問い合わせ</h2>
          {operations.operatorName && operations.contactUrl ? (
            <p>
              運営者は{operations.operatorName}です。問い合わせは
              <a href={operations.contactUrl}>公開の問い合わせ窓口</a>
              から受け付けます。
            </p>
          ) : (
            <p>
              実際の運営者名と問い合わせ先は未設定です。本番公開前に掲示します。
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
