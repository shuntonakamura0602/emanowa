# えまのわ

みんなの願いが集まる、日本語のオンライン絵馬サービスです。

P0 の段階A「土台と契約」まで実装済みです。画面と共有契約は確認できますが、Supabase/Postgres への保存、匿名所有権、Canvas 地図、共有画像、通報は後続段階です。保存処理が未接続の状態で成功表示へ進むことはありません。

## 必要な環境

- Node.js 24.17.0（`.nvmrc` / `.node-version` で固定。プロジェクト下限は22.12、Next.js単体の最低要件は20.9）
- pnpm 11.25.0（`package.json#packageManager` で固定）
- Supabase/Postgres は段階Bから必要。未設定でも段階Aの画面・型・テスト・ビルドは確認できます

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

## 設定

`.env.example` は値を持たない設定一覧です。秘密情報をコミットしないでください。

| 種類         | 設定                                                     | 扱い                                                                      |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 公開可       | `NEXT_PUBLIC_SUPABASE_URL`                               | Supabase Auth の接続先                                                    |
| 公開可       | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                   | ブラウザ用 publishable key。秘密鍵の代用は禁止                            |
| 公開可       | `NEXT_PUBLIC_CAPTCHA_SITE_KEY`                           | CAPTCHA の site key                                                       |
| サーバー専用 | `APP_ORIGIN`                                             | 正規URL・認証の戻り先。ローカル例は `http://localhost:3000`               |
| サーバー専用 | `DATABASE_URL`                                           | BFF 用の限定・非所有者・`NOBYPASSRLS` ロール                              |
| サーバー専用 | `MIGRATION_DATABASE_URL`                                 | migration 専用。通常APIでは使用しない                                     |
| サーバー専用 | `CAPTCHA_SECRET_KEY`、`RATE_LIMIT_HMAC_SECRET`           | ブラウザへ渡さない                                                        |
| サーバー判定 | `ENABLE_GROUPS`、`ENABLE_FULFILLMENT`、`ENABLE_PAYMENTS` | 空欄は false。P0 では全て false                                           |
| サーバー判定 | `FEATURED_WORLD_SLUG`                                    | 空欄は `2027`。現在年から自動決定しない                                   |
| 実行環境     | `EMANOWA_ENVIRONMENT`                                    | `development` / `test` / `staging` / `production`。空欄は development     |
| データ経路   | `EMANOWA_DATA_MODE`                                      | `database` / `demo` / `unconfigured`。staging/production では demo を拒否 |

Supabase を接続するときは、プロジェクトの Connect 画面から URL と publishable key を取得します。段階Bでは匿名サインインと manual linking を有効にし、SSR は `@supabase/ssr` の Cookie 方式で構成します。`DATABASE_URL` には `postgres`、テーブル所有者、`BYPASSRLS`、`service_role` を使わず、migration 接続と分離してください。

本番では `EMANOWA_ENVIRONMENT=production` を明示します。不足・不正な設定はエラーとして検出され、デモへフォールバックしません。

## 検証コマンド

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

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

- 本番の保存先は未接続です。デモ fixture やブラウザ状態を保存成功として扱いません
- DB schema、RLS、匿名 Auth、所有権、同時投稿の原子的な競合処理は段階Bで実装します
- 作成・編集・削除を画面からDBへ接続するのは段階Cです
- Canvas 地図は段階D、共有画像と近くへの招待は段階Eです
- P1/P2 のグループ、成就、課金は機能フラグを含め既定で無効です

実装状況と検証記録は [docs/implementation-status.md](docs/implementation-status.md)、仕様判断は [docs/decisions.md](docs/decisions.md) を参照してください。仕様の正本は [docs/spec/emanowa_spec_v1/00_README.md](docs/spec/emanowa_spec_v1/00_README.md) から始まります。
