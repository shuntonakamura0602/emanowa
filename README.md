# えまのわ

みんなの願いが集まる、日本語のオンライン絵馬サービスです。

P0 の段階C「絵馬の作成と本人管理」まで実装済みです。入力・公開プレビュー・原子的な投稿、本人だけの編集と削除、version競合、冪等再送、任意メールOTPによる同一UIDの引継ぎと別ブラウザーでの復帰を、ローカルの実Postgres/Auth/BFF経路で検証できます。

## 必要な環境

- Node.js 24.17.0（`.nvmrc` / `.node-version` で固定。プロジェクト下限は22.12、Next.js単体の最低要件は20.9）
- pnpm 11.25.0（`package.json#packageManager` で固定）
- Docker Desktop（ローカルSupabase/Postgres/Authの統合試験に使用）
- Supabase CLI 2.122.0（devDependencyとして固定）
- 外部設定なしでも画面・型・ユニットテスト・ビルドは確認でき、DockerがあればDB/Auth統合試験まで実行できます

システムの既定 `node` が古い場合は、リポジトリで固定した Node を先に選択してください。

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@11.25.0 --activate
```

## セットアップと起動

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

ブラウザで `http://localhost:3000` を開きます。環境変数が空の場合、外部サービス未接続であることを画面と開発ログに表示し、DB 保存へ黙って切り替えたり、デモデータを本番保存として扱ったりしません。

## ローカルSupabase / DB

```bash
pnpm supabase:start
pnpm db:reset
pnpm db:local-role
```

最後のコマンドが表示するローカル専用 `DATABASE_URL` と、`pnpm exec supabase status --output env` のAPI URL / publishable keyを `.env.local` に設定します。詳しい値、cloud設定、限定roleの作り方は [docs/stage-b-setup.md](docs/stage-b-setup.md)、メールOTPと段階Cの確認方法は [docs/stage-c-setup.md](docs/stage-c-setup.md) にあります。

停止するときは次を実行します。

```bash
pnpm supabase:stop
```

## 設定

`.env.example` は値を持たない設定一覧です。秘密情報をコミットしないでください。

| 種類         | 設定                                                     | 扱い                                                                                                                    |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 公開可       | `NEXT_PUBLIC_SUPABASE_URL`                               | Supabase Auth の接続先                                                                                                  |
| 公開可       | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                   | ブラウザ用 publishable key。秘密鍵の代用は禁止                                                                          |
| 公開可       | `NEXT_PUBLIC_CAPTCHA_SITE_KEY`                           | CAPTCHA の site key                                                                                                     |
| サーバー専用 | `APP_ORIGIN`                                             | 正規URL・認証の戻り先。ローカル例は `http://localhost:3000`                                                             |
| サーバー専用 | `DATABASE_URL`                                           | BFF 用の限定・非所有者・`NOBYPASSRLS` ロール                                                                            |
| サーバー専用 | `MIGRATION_DATABASE_URL`                                 | migration 専用。通常APIでは使用しない                                                                                   |
| サーバー専用 | `CAPTCHA_SECRET_KEY`、`RATE_LIMIT_HMAC_SECRET`           | ブラウザへ渡さない                                                                                                      |
| サーバー判定 | `ENABLE_GROUPS`、`ENABLE_FULFILLMENT`、`ENABLE_PAYMENTS` | 空欄は false。P0 では全て false                                                                                         |
| サーバー判定 | `FEATURED_WORLD_SLUG`                                    | 空欄は `2027`。現在年から自動決定しない                                                                                 |
| 実行環境     | `EMANOWA_ENVIRONMENT`                                    | `development` / `test` / `staging` / `production`。開発時の空欄は development、`NODE_ENV=production` の空欄は書込み停止 |
| データ経路   | `EMANOWA_DATA_MODE`                                      | `database` / `demo` / `unconfigured`。staging/production では demo を拒否                                               |

Supabase を接続するときは、プロジェクトの Connect 画面から URL と publishable key を取得します。匿名サインインとmanual linkingを有効にし、SSRは `@supabase/ssr` のCookie方式で構成します。`DATABASE_URL` はtransaction poolerの `emanowa_app` に限定され、`postgres`、テーブル所有者、`BYPASSRLS`、`service_role` は設定検証で拒否します。migration接続とは分離してください。staging/productionではCAPTCHA site/secret設定が揃わない匿名登録をfail closedにします。

## 段階CまでのAPI

現在の同一オリジンBFFは次を実装しています。全応答は `no-store` です。

- `POST /api/v1/auth/anonymous`: 明示操作時だけ匿名セッションを作成し、既存の有効セッションは再利用
- `GET /api/v1/worlds/{slug}`: DB時刻・受付可否・内容なし集計
- `GET /api/v1/worlds/{slug}/emas/{publicId}`: public/unlistedの正確なURLによる公開投影。owner-only本文は常に `null`
- `POST /api/v1/worlds/{slug}/emas`: 検証済みUID、厳密入力、Idempotency-Key、同一transactionで原子的に作成
- `GET /api/v1/me/emas?world={slug}`: 検証済み本人だけの原本文
- `PATCH /api/v1/me/emas/{publicId}`: 本人だけの部分更新、expectedVersion、Idempotency-Key
- `DELETE /api/v1/me/emas/{publicId}`: 本人だけの削除、本文・表示名の抹消、旧公開IDの墓標保持
- `GET /api/v1/me/worlds`: 本人の年別一覧を厳格なkeyset cursorで取得
- `POST /api/v1/auth/email/link`: 現在の匿名UIDへメールを追加
- `POST /api/v1/auth/email/recover`: 既存メールへOTPを送信（未登録かどうかを応答で区別しない）
- `POST /api/v1/auth/email/verify`: 用途別OTP検証。復帰後も元の所有UIDを利用
- `POST /api/v1/auth/signout`: ローカルセッションを終了し、画面上の本人限定情報を消去

ブラウザーからowner UID、status、public IDを指定して所有権を変更するAPIはありません。公開GETはAuth Cookie不要で、閲覧だけでは匿名アカウントを作りません。

本番では `EMANOWA_ENVIRONMENT=production` を明示します。不足・不正な設定はエラーとして検出され、デモへフォールバックしません。

## 検証コマンド

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Docker上の実DB/Authを含む段階C検証は、Supabase起動後に実行します。

```bash
pnpm test:stage-c
```

`test:stage-c` はDB reset、全pgTAP、限定ロール、100件同時要求（最大20 DB接続）、匿名Auth、実BFF経由の投稿、本人更新・削除、第三者拒否、公開縮小、メール引継ぎと別CookieのOTP復帰までをまとめて確認します。段階Bだけは `pnpm test:stage-b`、DB契約だけは `pnpm test:db` で再実行できます。

静的検証をまとめて実行する場合は次を使います。

```bash
pnpm check
```

本番ビルドをローカルで起動する場合は、`pnpm build` の後に実行します。

```bash
pnpm start
```

## 開発用サンプル

開発・テスト専用の明示的なサンプルを `.demo/ema-fixtures.json` に作成できます。このファイルは無視対象で、アプリの本番保存先ではありません。各データには「サンプル」と分かる印を持たせています。

```bash
pnpm demo:seed
pnpm demo:clear
```

`demo:clear` は `.demo/` だけを削除し、復元できません。`NODE_ENV=production` または `EMANOWA_ENVIRONMENT=staging|production` では両コマンドを拒否します。

## 現段階の制限

- cloud Supabase、CAPTCHA、運営用DB secretはリポジトリに設定していません。設定不足時はデモへ切り替えず書き込みを拒否します
- cloud SupabaseでのSMTP到達性、CAPTCHA、stagingドメインのCookie/OTP E2Eは、実project設定後の確認が必要です
- 複数タブの所有者切替競合を防ぐため、投稿・本人取得/更新/削除・メール追加/復帰要求・OTP検証・ログアウトにはWeb Locks対応ブラウザーが必要です。未対応時は安全側で操作を拒否します
- 共有レート制限、通報、管理者の非表示・復帰は段階Fで接続します
- Canvas 地図は段階D、共有画像と近くへの招待は段階Eです
- P1/P2 のグループ、成就、課金は機能フラグを含め既定で無効です

実装状況と検証記録は [docs/implementation-status.md](docs/implementation-status.md)、仕様判断は [docs/decisions.md](docs/decisions.md) を参照してください。仕様の正本は [docs/spec/emanowa_spec_v1/00_README.md](docs/spec/emanowa_spec_v1/00_README.md) から始まります。
