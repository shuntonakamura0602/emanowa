import Link from "next/link";

export const metadata = {
  title: "運営管理",
};

export default function AdminPage() {
  return (
    <section className="container page-section">
      <div className="admin-lock">
        <span className="admin-lock__icon" aria-hidden="true">
          鍵
        </span>
        <p className="eyebrow">運営者専用</p>
        <h1>管理機能は利用できません</h1>
        <p className="muted">
          管理者認証と権限確認はまだ接続していません。URLを知っていることや画面を隠すことを、管理権限の代わりにはしません。
        </p>
        <p className="fine-print">
          通報一覧・非表示・復帰・監査操作は、段階Fでサーバー側の認可とともに実装します。
        </p>
        <Link className="button button--secondary" href="/">
          ホームへ戻る
        </Link>
      </div>
    </section>
  );
}
