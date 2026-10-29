import Link from "next/link";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AdminMfaSetup } from "@/components/admin/admin-mfa-setup";
import { getAdminPageAuthState } from "@/server/admin/auth";
import { isCurrentAdmin } from "@/server/admin/repository";
import { getPublicRuntimeConfig } from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "運営管理",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

function AdminUnavailable({
  reason,
}: {
  reason: "auth" | "permission" | "configuration";
}) {
  const content =
    reason === "auth"
      ? {
          title: "本人確認を完了してください",
          body: "本人管理から確認済みメールで復帰した後、このページへ戻ってください。匿名セッションや期限切れのセッションでは管理画面を開けません。",
        }
      : reason === "permission"
        ? {
            title: "管理者権限がありません",
            body: "MFA認証は完了していますが、現在のアカウントは有効な運営台帳へ登録されていません。管理担当者へ確認してください。",
          }
        : {
            title: "管理機能を確認できません",
            body: "管理DB接続または運営台帳を確認できませんでした。管理担当者が設定と稼働状態を確認してください。",
          };
  return (
    <div className="admin-lock">
      <span className="admin-lock__icon" aria-hidden="true">
        鍵
      </span>
      <h2>{content.title}</h2>
      <p className="muted">{content.body}</p>
      <p className="fine-print">
        管理者の有無、メールアドレス、権限台帳の内容はこの画面へ表示しません。
      </p>
      <Link
        className="button button--secondary"
        href={reason === "auth" ? "/me" : "/"}
      >
        {reason === "auth" ? "本人管理へ進む" : "ホームへ戻る"}
      </Link>
    </div>
  );
}

export default async function AdminPage() {
  const publicConfig = getPublicRuntimeConfig();
  let gate: "auth" | "mfa" | "permission" | "configuration" | "authorized" =
    "configuration";
  try {
    const authClient = await createSupabaseServerClient();
    const authState = await getAdminPageAuthState(authClient);
    if (authState.kind === "mfa_required") {
      gate = "mfa";
    } else if (authState.kind !== "verified") {
      gate = "auth";
    } else {
      gate = (await isCurrentAdmin(authState.actor.uid))
        ? "authorized"
        : "permission";
    }
  } catch {
    gate = "configuration";
  }

  return (
    <section className="container page-section">
      <div className="page-intro">
        <p className="eyebrow">運営者専用</p>
        <h1>通報と公開状態を管理する</h1>
        <div className="page-intro__copy">
          <p>
            確認済みメール、MFA、サーバー管理台帳の三つを満たす運営者だけが利用できます。URLを知っていることは権限になりません。
          </p>
          <p>
            作品の非表示・復帰・削除と、通報の対応状態は別々の操作です。すべての作品操作を監査記録へ残します。
          </p>
        </div>
      </div>
      {gate === "authorized" ? <AdminDashboard /> : null}
      {gate === "mfa" &&
      publicConfig.supabase.url &&
      publicConfig.supabase.publishableKey ? (
        <AdminMfaSetup
          supabaseUrl={publicConfig.supabase.url}
          publishableKey={publicConfig.supabase.publishableKey}
        />
      ) : null}
      {gate === "mfa" &&
      (!publicConfig.supabase.url || !publicConfig.supabase.publishableKey) ? (
        <AdminUnavailable reason="configuration" />
      ) : null}
      {gate === "auth" ? <AdminUnavailable reason="auth" /> : null}
      {gate === "permission" ? <AdminUnavailable reason="permission" /> : null}
      {gate === "configuration" ? (
        <AdminUnavailable reason="configuration" />
      ) : null}
    </section>
  );
}
