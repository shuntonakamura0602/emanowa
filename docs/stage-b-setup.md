# 段階B — Supabase / DB設定手順

この文書は、段階Bの非公開DB・匿名Auth・限定ロールをローカルまたはSupabase projectで再現する手順です。秘密値はリポジトリへ保存しません。

## 安全境界

- 原本はData APIへ公開しない `app_private` schemaに置く。`supabase/config.toml` のexposed schemasへ追加しない。
- ブラウザーは同一オリジンの `/api/v1` だけを利用する。`anon` / `authenticated` / `service_role` に内部schemaの権限を付与しない。
- 通常BFFは `emanowa_app` で接続する。このロールはmigration所有者ではなく、`NOSUPERUSER`、`NOBYPASSRLS` である。
- migrationはパスワードをコミットしないため、`emanowa_app` を `NOLOGIN` で作る。LOGINとパスワードは環境ごとに後から設定する。
- UIDはSupabase `getClaims()` で検証した `sub` だけを、同じDB transactionの `app.actor_id` に設定する。リクエストJSONのowner IDは使用しない。
- 公開APIはAuth Cookieを必要とせず、閲覧だけでは `signInAnonymously()` を呼ばない。

## ローカル環境

Docker Desktopを起動し、固定した依存をインストールしてから実行します。

```bash
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm db:reset
```

`db:reset` はmigrationを最初から適用し、`2027` worldをmigration管理の永続プロダクトデータとして作成します。`supabase/seed.sql` は意図的なno-opで、100万の空枠や空作品を作りません。

手動でNext.jsを起動する場合だけ、ローカルDBの限定ロールへランダムな一時パスワードを設定します。

```bash
pnpm db:local-role
```

表示された `DATABASE_URL` を `.env.local` にコピーします。これは `127.0.0.1:54322` のローカルSupabase専用です。`pnpm db:reset` を行うと `emanowa_app` は再び `NOLOGIN` になります。
表示されたURLには一時パスワードが含まれるため、issue、チャット、CIログへ貼り付けません。

`pnpm exec supabase status --output env` でローカルのAPI URLとpublishable keyを確認し、`.env.local` を次のように設定します。実際の値はコミットしません。

```dotenv
EMANOWA_ENVIRONMENT=development
EMANOWA_DATA_MODE=database
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
DATABASE_URL=<pnpm db:local-roleが表示したURL>
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
ENABLE_GROUPS=false
ENABLE_FULFILLMENT=false
ENABLE_PAYMENTS=false
```

ローカル設定は匿名サインインとmanual linkingを有効にし、CAPTCHAを無効にしています。CAPTCHA省略はdevelopment/testだけで許可されます。

## DB/Auth統合試験

```bash
pnpm test:db
pnpm test:stage-b
```

`test:db` はローカルDBコンテナの管理socketだけを使い、秘密値をファイルへ保存せずpgTAPを実行します。`test:stage-b` はDBをresetしてからpgTAPとNode統合試験を実行します。統合試験ではローカルAuthの別UID、限定LOGINロール、同一枠への100件同時要求（最大20 DB接続）、同一所有者の別枠並行、冪等再送、owner-only/unlisted、Data API遮断、接続再利用時のtransaction-local UID消去を確認します。Next.jsも一時ポートで起動し、公開GETがAuthユーザー/Cookieを作らないこと、明示的な匿名セッション作成、Cookie付き投稿、本人取得、公開詳細までを実BFF経由で確認します。

終了時は次でコンテナを停止できます。

```bash
pnpm supabase:stop
```

## Supabase projectへ設定する項目

1. Auth ProvidersでAnonymous Sign-Insを有効にする。
2. Manual Linkingを有効にする。匿名UIDへメールidentityを追加する段階Cで使用する。
3. hCaptchaまたはCloudflare TurnstileをAuthに設定し、site keyとsecretを環境変数へ設定する。
4. Site URLと許可redirectを本番・stagingの正規オリジンへ限定する。
5. Data APIのexposed schemasに `app_private` を追加しない。新規テーブルの自動公開も無効にする。
6. migrationは管理用接続で適用し、通常API接続とは分離する。

```bash
pnpm exec supabase login
pnpm exec supabase link
pnpm exec supabase db push
```

`supabase/seed.sql` は空枠を生成しない意図を示すno-opです。remoteへ `--include-seed` で適用する必要はありません。本番worldの状態・期間はmigration後に運用値を確認してから変更します。

migration適用後、管理接続で環境専用の強いパスワードを設定します。値はSQL migrationやログへ残しません。

```sql
alter role emanowa_app login password '<環境ごとに生成した秘密値>';
```

通常APIの `DATABASE_URL` はこのロールのtransaction pooler接続（SupabaseのConnect画面にあるtransaction mode、通常はポート6543）を使います。migration、`pg_dump`、復旧だけは `MIGRATION_DATABASE_URL` の直接接続を使います。通常APIへ `postgres`、`supabase_admin`、テーブル所有者、`BYPASSRLS`、`service_role` を設定するとアプリの設定検証が拒否します。

公開環境では少なくとも次を設定します。

```dotenv
EMANOWA_ENVIRONMENT=staging # または production
EMANOWA_DATA_MODE=database
APP_ORIGIN=https://<canonical origin>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
NEXT_PUBLIC_CAPTCHA_SITE_KEY=<site key>
DATABASE_URL=<emanowa_app transaction pool URL>
MIGRATION_DATABASE_URL=<migration-only direct URL>
CAPTCHA_SECRET_KEY=<server secret/configuration sentinel>
RATE_LIMIT_HMAC_SECRET=<random server secret>
```

匿名AuthはDB上 `authenticated` roleを使うため、role名だけで本人判定をしません。匿名アカウントの自動削除はSupabase側にないため、作品や通報を所有しない休眠アカウントだけを対象にする運用を、段階F/Hで追加します。

参照: [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)、[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Using Custom Schemas](https://supabase.com/docs/guides/api/using-custom-schemas)、[Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
