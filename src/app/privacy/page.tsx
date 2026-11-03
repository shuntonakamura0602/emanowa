import { PageIntro } from "@/components/site-shell";
import { getPublicRuntimeConfig } from "@/server/config";

export const metadata = {
  title: "プライバシー",
};

function formatPolicyDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export default function PrivacyPage() {
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
        title="プライバシーについて"
      >
        {publication.ready ? (
          <p>
            えまのわが扱う投稿、認証情報、ログと、それぞれの公開範囲・保存方針を説明します。
          </p>
        ) : (
          <p>
            これは公開前の暫定説明です。実際の運営者情報と保存期間の確認が完了するまで公開準備中として扱います。
          </p>
        )}
      </PageIntro>

      <div className="policy-stack">
        <section className="policy-section">
          <h2>願いの本文</h2>
          <p>
            本文を「自分だけ」にした場合、公開API、HTML、共有画像、メタ情報へ含めません。入力内容を外部AIへ送信しません。
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
        <section className="policy-section">
          <h2>保存期間</h2>
          {publication.retention.content &&
          publication.retention.backups &&
          publication.retention.logs ? (
            <>
              <p>
                <strong>投稿内容：</strong>
                {publication.retention.content}
              </p>
              <p>
                <strong>バックアップ：</strong>
                {publication.retention.backups}
              </p>
              <p>
                <strong>ログ：</strong>
                {publication.retention.logs}
              </p>
            </>
          ) : (
            <p>
              投稿内容、バックアップ、ログの具体的な保存期間は公開準備中です。未確定の状態で無期限保存や即時の完全消去を約束しません。
            </p>
          )}
          <p>
            削除した内容をバックアップから復旧する場合は、復旧後に削除と公開範囲の変更を再適用し、安全を確認するまで公開配信を再開しません。SNSや第三者が保存したコピーは、このサービスから消去できません。
          </p>
        </section>
        <section className="policy-section">
          <h2>運営と問い合わせ</h2>
          {operations.operatorName && operations.contactUrl ? (
            <p>
              運営者は{operations.operatorName}です。プライバシーに関する連絡は
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
