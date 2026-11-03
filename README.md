# えまのわ

みんなの願いが集まる、日本語のオンライン絵馬サービスです。

P0 の段階H「公開環境の準備」は、リポジトリ内の実装とローカル検証まで完了しています。公開設定gate、正式文面の設定枠、検索除外、health/preflight、AAL2管理者によるworld単位の受付停止・監査、migration・backup・監視・cleanupのrunbookを用意しました。実ドメイン、cloud Supabase、SMTP、Turnstile、backup/PITR、監視とstaging/production E2Eは外部設定待ちのため、現時点の公開判定はNO-GOです。

## 必要な環境

- Node.js 24.17.0（`.nvmrc` / `.node-version` で固定。プロジェクト下限は22.12、Next.js単体の最低要件は20.9）
- pnpm 11.25.0（`package.json#packageManager` で固定）
- Docker Desktop（ローカルSupabase/Postgres/Authの統合試験に使用）
- Supabase CLI 2.122.0（devDependencyとして固定）
- Google Chrome（段階Gの実ブラウザー検証に使用。macOSの標準配置以外は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` で指定）
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

注意: `pnpm db:reset` はローカルSupabase DBの全データを削除し、migrationから再作成します。必要なローカルデータは先に退避してください。remote DBを対象にするコマンドではありません。

```bash
pnpm supabase:start
pnpm db:reset
pnpm db:local-role
```

最後のコマンドが表示するローカル専用 `DATABASE_URL` と `ADMIN_DATABASE_URL`、`pnpm exec supabase status --output env` のAPI URL / publishable key、`openssl rand -hex 32` で生成したdevelopment専用 `RATE_LIMIT_HMAC_SECRET` を `.env.local` に設定します。HMAC secretはdevelopmentでも変更要求に必須です。詳しい値、cloud設定、限定roleの作り方は [docs/stage-b-setup.md](docs/stage-b-setup.md)、メールOTPと段階Cの確認方法は [docs/stage-c-setup.md](docs/stage-c-setup.md)、地図・探索は [docs/stage-d-setup.md](docs/stage-d-setup.md)、共有・招待は [docs/stage-e-setup.md](docs/stage-e-setup.md)、通報・管理者MFA・共有rate limitは [docs/stage-f-setup.md](docs/stage-f-setup.md)、ブラウザー性能・アクセシビリティ・復旧訓練は [docs/stage-g-setup.md](docs/stage-g-setup.md)、公開環境の準備は [docs/stage-h-setup.md](docs/stage-h-setup.md) にあります。公開判断では [docs/launch-checklist.md](docs/launch-checklist.md) を複製して証跡を記録してください。

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
| サーバー専用 | `DATABASE_URL`                                           | 完全指定したBFF用URL。限定・非所有者・`NOBYPASSRLS`の `emanowa_app` ロール                                              |
| サーバー専用 | `ADMIN_DATABASE_URL`                                     | 完全指定した管理BFF専用URL。別secret・別pool・`emanowa_admin_app` ロール。通常APIと共用しない                           |
| サーバー専用 | `CAPTCHA_SECRET_KEY`、`RATE_LIMIT_HMAC_SECRET`           | ブラウザへ渡さない                                                                                                      |
| サーバー専用 | `TRUSTED_PROXY_HOPS`                                     | 画像rate limitで信頼するreverse proxy段数。staging/productionでは必須                                                   |
| サーバー判定 | `ENABLE_GROUPS`、`ENABLE_FULFILLMENT`、`ENABLE_PAYMENTS` | 空欄は false。P0 では全て false                                                                                         |
| サーバー判定 | `FEATURED_WORLD_SLUG`                                    | 空欄は `2027`。現在年から自動決定しない                                                                                 |
| 公開情報     | `OPERATOR_NAME`、`CONTACT_URL`                           | 実際の運営者名とHTTPS問い合わせ先。仮情報を本番値にしない                                                               |
| 公開情報     | `POLICY_EFFECTIVE_DATE`、各 `*_RETENTION_NOTICE`         | 承認済みの適用日と、投稿・backup・logの実際の保存方針                                                                   |
| 公開承認     | `PUBLICATION_APPROVED`                                   | productionの条件付き検証・公開承認後だけ `true`。不足時は新規投稿・indexing・readyを停止                                |
| 実行環境     | `EMANOWA_ENVIRONMENT`                                    | `development` / `test` / `staging` / `production`。開発時の空欄は development、`NODE_ENV=production` の空欄は書込み停止 |
| データ経路   | `EMANOWA_DATA_MODE`                                      | `database` / `demo` / `unconfigured`。staging/production では demo を拒否                                               |

Supabase を接続するときは、プロジェクトの Connect 画面から URL と publishable key を取得します。匿名サインイン、manual linking、TOTP MFAを有効にし、SSRは `@supabase/ssr` のCookie方式で構成します。`DATABASE_URL` はtransaction poolerの `emanowa_app`、`ADMIN_DATABASE_URL` は別secretの `emanowa_admin_app` に限定され、username、password、host、port、database、remoteの安全な `sslmode` をURLへ明示します。`postgres`、テーブル所有者、`BYPASSRLS`、`service_role`、query/ambient `PG*` による接続契約の上書きは拒否します。migration接続とは分離してください。staging/productionではCAPTCHA site/secret、32バイト以上のrate-limit HMAC secret、信頼proxy段数が揃わない変更要求をfail closedにします。

## 段階H時点のP0 API

現在の同一オリジンBFFは次を実装しています。公開概要だけは内容を持たない集計として共有キャッシュ最大30秒、それ以外の公開・本人応答は `no-store` です。

- `GET /api/health/live`: process応答だけを200 `{"status":"live"}` で返す
- `GET /api/health/ready`: 公開設定・通常DB・featured worldが利用可能なときだけ200 `{"status":"ready"}`
- `GET /api/health/operations`: 管理専用DBの緊急操作境界が利用可能なときだけ200 `{"status":"ready"}`
- `POST /api/v1/auth/anonymous`: 厳格な用途を受け、投稿用は公開gate、通報用は回復write gateを満たす明示操作時だけ匿名セッションを作成。既存の有効セッションは再利用
- `GET /api/v1/worlds/{slug}`: DB時刻・受付可否・内容なし集計
- `GET /api/v1/worlds/{slug}/overview?cellSize=20|100`: 本文・名前・公開IDを含まない疎な地図集計。最大2,500領域
- `GET /api/v1/worlds/{slug}/chunks?cx={0..49}&cy={0..49}`: 20×20の1チャンク。公開絵馬と識別子なしの占有表示だけを返す
- `GET /api/v1/worlds/{slug}/emas?limit=&cursor=&category=`: public/activeだけの新着一覧。既定24・最大50件の厳格keyset cursor
- `GET /api/v1/worlds/{slug}/emas/random?category=`: public/activeだけを索引付きで1件探索。対象なしは `item:null`
- `GET /api/v1/worlds/{slug}/emas/{publicId}`: public/unlistedの正確なURLによる公開投影。owner-only本文は常に `null`
- `GET /api/v1/worlds/{slug}/emas/{publicId}/image?variant=og|square`: 公開投影だけを描画する1200×630または1080×1080 PNG
- `POST /api/v1/worlds/{slug}/emas/{publicId}/reports`: 列挙理由と任意のplain-text補足を送る。open重複は同じreport IDを返し、自動非表示にしない
- `GET /api/v1/worlds/{slug}/nearby?near={publicId}`: 招待元の近隣から最大8件の未予約候補
- `GET /api/v1/worlds/{slug}/nearby?x={0..999}&y={0..999}`: 指定座標の近隣候補。`near` との混在は拒否
- `POST /api/v1/worlds/{slug}/emas`: 検証済みUID、厳密入力、Idempotency-Key、同一transactionで原子的に作成
- `GET /api/v1/me/emas?world={slug}`: 検証済み本人だけの原本文
- `PATCH /api/v1/me/emas/{publicId}`: 本人だけの部分更新、expectedVersion、Idempotency-Key
- `DELETE /api/v1/me/emas/{publicId}`: 本人だけの削除、本文・表示名の抹消、旧公開IDの墓標保持
- `GET /api/v1/me/worlds`: 本人の年別一覧を厳格なkeyset cursorで取得
- `POST /api/v1/auth/email/link`: 現在の匿名UIDへメールを追加
- `POST /api/v1/auth/email/recover`: 既存メールへOTPを送信（未登録かどうかを応答で区別しない）
- `POST /api/v1/auth/email/verify`: 用途別OTP検証。復帰後も元の所有UIDを利用
- `POST /api/v1/auth/signout`: ローカルセッションを終了し、画面上の本人限定情報を消去
- `GET /api/v1/admin/reports`: fresh Auth、確認済みメール、AAL2、DB台帳を満たす管理者だけの通報キュー
- `POST /api/v1/admin/emas/{publicId}/moderation`: version付きの非表示・復帰・削除と、本文を持たない監査記録
- `PATCH /api/v1/admin/reports/{reportId}`: 作品操作とは別に通報を対応済み・対応不要へ更新
- `GET/PATCH /api/v1/admin/worlds/{slug}/posting`: fresh AAL2管理者だけがworld単位の新規受付を確認・停止・再開。expected current、冪等key、固定理由、本文なし監査を必須化

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

Docker上の実DB/Auth、段階Eの共有・招待、段階Fの通報・実TOTP AAL2・2instance制限、段階Gの実ブラウザー・障害回復・ローカルbackup/restore訓練、段階Hの受付停止同時実行を含む検証は、Supabase起動後に実行します。

注意: 次のコマンドはローカルSupabase DBの全データを削除し、migrationから再作成します。必要なローカルデータは先に退避してください。remote DBには使用できません。

```bash
pnpm test:stage-h
```

`test:stage-h` は段階B〜Gの全回帰に加え、受付停止の別key競合、同key再送、停止後の新規作成拒否と公開world状態を実DBの別接続で確認します。段階Gの途中でローカル `app_private` schemaを一度削除して復元するため、必要なローカルデータは必ず先に退避してください。段階Gまでは `pnpm test:stage-g`、段階Fまでは `pnpm test:stage-f`、段階Eまでは `pnpm test:stage-e`、段階Dまでは `pnpm test:stage-d`、段階Cまでは `pnpm test:stage-c`、段階Bだけは `pnpm test:stage-b`、DB契約だけは `pnpm test:db` で再実行できます。

公開前のGET-only検査は、承認済みoriginとworldを明示して実行します。productionではHSTS、公開ページ、health、operations、robots、sitemapも検査し、投稿・Auth user・Cookieを作りません。

```bash
pnpm stage-h:preflight -- \
  --url 'https://<承認済みorigin>' \
  --environment staging \
  --world-slug '<承認済み4桁slug>'
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

## 現段階の制限・公開阻害項目

- 実production/staging domain、HTTPS/HSTS/DNS、cloud Supabase、CAPTCHA、通常/admin DB secret、rate-limit HMAC secret、信頼proxy段数、本番MFA factorはリポジトリに設定していません。設定不足時はデモへ切り替えず、新規投稿と公開判定を拒否します
- 実運営者、問い合わせ先、規約適用日、投稿・backup・logの保存方針、world受付期間と公開承認は未確定です。仮値では `PUBLICATION_APPROVED=true` にしません
- cloud SupabaseでのSMTP到達性、CAPTCHA、stagingドメインのCookie/OTP E2Eは、実project設定後の確認が必要です
- 複数タブの所有者切替競合を防ぐため、投稿・本人取得/更新/削除・メール追加/復帰要求・OTP検証・ログアウトにはWeb Locks対応ブラウザーが必要です。未対応時は安全側で操作を拒否します
- Google Chromeのheadless実ブラウザーでは360/390/768/1440px、キーボード、dialog focus、reduced motion、axe WCAG 2.2 AA、密集地図10秒の30fps目標を確認済みです。実端末のタッチ・ピンチ、手動スクリーンリーダー、OSごとの視覚確認はstagingで必要です
- 実X/LINEアプリでの送信、SNS crawlerのOG表示、実端末のClipboard/画像保存は、stagingと代表端末での最終確認が必要です
- 段階GのLCP、転送量、API p95、fpsはローカルproduction buildと通信・CPUエミュレーションの値であり、公開環境の実利用p75、リージョン間遅延、cloudの20同時性能を保証しません
- ローカルでは論理backup/restoreと削除・非公開化の再適用を確認済みですが、本番backupの保存先、暗号化、保持期間、PITR、復旧権限、privacy replay台帳、定期訓練は外部環境で確定する必要があります
- provider-neutralな計測eventは実装済みですが、本番analytics collectorは未設定です。本文・表示名・メール・公開ID・URL・認証情報を送らない接続が必要です
- cloudの複数instance、実proxy header、Turnstile/Auth側rate limit、custom SMTP、監視/通知/費用上限、管理当番・問い合わせ・法的エスカレーションは公開環境での設定と確認が必要です
- staging実端末E2Eとcleanup、条件付きproduction read-only/write E2Eが未実施のため、P0段階Hの公開環境での完成条件は未達です
- P1/P2 のグループ、成就、課金は機能フラグを含め既定で無効です

実装状況と検証記録は [docs/implementation-status.md](docs/implementation-status.md)、仕様判断は [docs/decisions.md](docs/decisions.md) を参照してください。仕様の正本は [docs/spec/emanowa_spec_v1/00_README.md](docs/spec/emanowa_spec_v1/00_README.md) から始まります。
