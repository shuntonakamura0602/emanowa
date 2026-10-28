# 実装状況

更新日: 2026-10-28

## 段階A — 土台と契約

対象段階:
: P0 段階A「土台と契約」（実装・ローカル統合検証完了）

実装した体験:
: Next.js App Router / TypeScript の起動可能な土台、全P0画面ルート、共通レイアウト、モバイル優先のデザイン変数、Canvas未実装時の一覧代替、外部サービス未接続表示を実装した。入力・保存・認証が未接続の間は操作を無効化し、投稿成功・架空の件数・架空の願いを表示しない。

: `World`、内部絵馬状態、`PublicEma`、`OwnerEma`、`ChunkCell`、入力DTO、receipt、API errorを独立schemaで定義した。NFC/LF正規化、grapheme・行数・UTF-8 byte・制御文字・双方向制御文字、座標・表示番号・UUID v4、未知キーを共通検証する。`owner_only`本文を公開DTOで必ず`null`とし、`unlisted`/`hidden`を地図では占有座標だけへ投影する。

: 2027 worldと`basic_wood`を設定化し、公開可能設定とサーバー秘密をallow-listで分離した。`ENABLE_GROUPS`、`ENABLE_FULFILLMENT`、`ENABLE_PAYMENTS`は既定false。開発専用fixtureの作成・削除と、本番指定時の拒否を実装した。

主な変更ファイル:
: `src/app/`、`src/components/site-shell.tsx`、`src/domain/`、`src/config/`、`src/server/config/`、`scripts/demo-*.mjs`、`package.json`、`pnpm-lock.yaml`、`.env.example`、`README.md`、`docs/decisions.md`、`AGENTS.md`

DB migration / 設定変更:
: DB migrationは段階Aでは作成していない。`EMANOWA_ENVIRONMENT`、`EMANOWA_DATA_MODE`、`FEATURED_WORLD_SLUG`、Supabase公開接続値、限定DB接続、migration接続、CAPTCHA、レート制限秘密、三つの機能フラグの設定例を追加した。実際の秘密値はコミットしていない。

検証した経路と結果:
: Node.js `24.17.0`、pnpm `11.25.0`で `pnpm format:check`、`pnpm lint`、`pnpm typecheck` は成功。`pnpm test` は3ファイル34件すべて成功。`pnpm build` はNext.js `16.4.3`で成功し、静的7画面と動的4ルート、共通404を生成した。

: 開発サーバーで `/`、`/w/2027`、`/w/2027/new`、有効UUIDの詳細・編集、`/me`、`/about`、`/terms`、`/privacy`、`/admin` がHTTP 200。不明なworldと不正UUIDはHTTP 404。ルートHTMLは未接続状態を表示し、実保存の成功を表示しない。

: サーバー専用の検証センチネルを設定した本番ビルドを行い、DB接続、migration接続、CAPTCHA secret、レート制限secretが `.next/static`、配信HTML、RSCへ含まれないことを検索で確認した。

: `demo:seed`で2件の明示的なサンプルだけを生成し、`owner_only`の`messageText`が`null`、本番指定のseedが終了コード1で拒否、`demo:clear`が `.demo/` だけを削除することを確認した。検証用 `.demo/` は削除済み。

実行していない検証と理由:
: Supabase Auth、Postgres、2 UIDの所有権、同一枠・同一所有者の同時投稿、冪等再送、RLS、プール接続のactor分離は段階Bのschema・外部設定が未実装。作成からDB保存、編集、削除は段階Cの対象。

: ブラウザ自動操作はローカル画面を開く実行基盤がNode runtime起動エラーとなり、360/390/768/1440pxのスクリーンショットと実機操作は未実施。CSSでは最小幅、44px操作領域、focus-visible、reduced-motion、横overflow防止を実装し、HTTPと本番ビルドでルートを確認した。実ブラウザの視覚・キーボード確認は次回も必要。

仕様からの変更と理由:
: 仕様の意味の変更はない。環境変数表記を`FEATURED_WORLD_SLUG`へ統一し、公開環境判定を`EMANOWA_ENVIRONMENT`へ分離した。依存バージョンとTypeScript 6系採用理由は`docs/decisions.md`へ記録した。初回の全体formatで仕様書Markdownの表記だけが整形されたため、以後は`docs/spec/**`をformatter対象外とした。

既知の問題・外部設定が必要な項目:
: Supabase project URL/publishable key、匿名Auth/manual linking、アプリ用限定・非所有者・`NOBYPASSRLS` DB role、migration接続、CAPTCHA、共有レート制限基盤、運営者情報、問い合わせ先は未設定。段階Aでは保存不能を画面とログで明示し、デモへ自動フォールバックしない。

: 画面は保存APIへ未接続であり、地図・一覧の実データ、共有、通報、管理操作もまだ動作しない。これは段階Aの意図した境界で、未完成ボタンや偽の成功レスポンスは公開していない。

次に実装する段階:
: 段階B「DBと匿名所有権」。非公開schema、P0 migrations、限定DB role、RLS、transaction-local actor、Supabase匿名Auth、公開投影、同時投稿・所有数競合の実DB検証を行う。

## 段階B — DBと匿名所有権

対象段階:
: P0 段階B「DBと匿名所有権」（実装・ローカルDB/Auth/HTTP統合検証完了）

実装した体験:
: `app_private` schemaにP0の10テーブル、制約、外部キー索引、live絵馬の枠・所有者部分一意索引、公開投影、占有、chunk集計、冪等receiptを実装した。100万の空枠行は作らず、`2027` worldはmigration管理の永続データとした。

: 通常BFFを非所有者・`NOBYPASSRLS`・既定`NOLOGIN`の `emanowa_app` に限定し、全10テーブルでRLSを有効化・強制した。直接table権限は与えず、固定search pathのallow-list関数だけを実行できる。Supabase Data APIから `app_private` を除外し、`anon`、`authenticated`、`service_role` からschema/table/function権限を剥奪した。

: Supabase SSRのrequest-scoped client、Proxyの `getClaims()`、明示POSTだけで作る匿名セッション、検証済みUIDのtransaction-local設定を実装した。公開GETは匿名ユーザーやCookieを作らず、壊れたセッションを別UIDへ置き換えない。staging/productionはCAPTCHA設定不足をfail closedにする。

: 公開world、公開詳細、本人取得、原子的作成のBFFを実装した。owner IDは入力として受け取らず、公開DTO・本人DTOを分離する。`owner_only`本文は公開投影へ保存せず、`unlisted`は直接URLだけで公開内容を取得でき、一覧・chunkでは占有だけを返す。作成はIdempotency-Key、同一所有者1枚、同一枠1枚を同じtransactionで確定する。

主な変更ファイル:
: `supabase/migrations/20261028060051_stage_b_private_schema.sql`、`supabase/config.toml`、`supabase/tests/`、`src/server/db/`、`src/server/ema/`、`src/server/auth/`、`src/server/supabase/`、`src/server/api/`、`src/app/api/v1/`、`src/proxy.ts`、`scripts/stage-b-integration.mjs`、`scripts/test-local-db.sh`、`scripts/setup-local-db-role.mjs`、`docs/stage-b-setup.md`

DB migration / 設定変更:
: Supabase CLI `2.122.0`、`pg 8.23.1`、`@types/pg 8.23.1`を固定した。ローカルではAnonymous Sign-Insとmanual linking、transaction poolerを有効にし、新規テーブルのData API自動公開を無効化した。限定roleのパスワードはmigrationへ入れず、ローカル試験と設定コマンドでランダムな一時値だけを使う。

: `DATABASE_URL` は `emanowa_app` だけを受理し、cloud pooler形式のユーザー名もrole本体を検査する。migration接続を分離し、staging/productionではCAPTCHA site/secretの両方を必須とした。

検証した経路と結果:
: Node.js `24.17.0`、pnpm `11.25.0`でformat、ESLint、TypeScript、本番ビルドに成功した。Vitestは12ファイル84件すべて成功。ダミーのDB、migration、CAPTCHA、HMAC秘密値を設定した本番ビルドでも、`.next/static`、配信HTML、RSCへ秘密値が含まれないことを検索で確認した。

: 完全に削除したローカルSupabase volumeから起動し、migrationと意図的なno-op seedを適用できた。pgTAPは2ファイル50件すべて成功し、10テーブル、権限、全RLS、固定search path、role非継承、2027 world、公開境界、冪等性、同一所有者・同一枠制約、原本との複合FK、commit後のactor消去を確認した。`app_private` だけを対象にDB lintを警告も失敗扱いで実行し、問題0件だった。

: 実ローカルAuthで異なる匿名UIDを発行した。2 UIDの同一枠競合は成功1件・`SLOT_TAKEN`1件、同じUIDの別枠競合は成功1件・`OWNER_LIMIT_REACHED`1件。100件同時要求（最大20 DB接続）は成功1件・`SLOT_TAKEN`99件で、原本・占有・公開投影に重複や孤立行を残さなかった。

: 同一冪等key/bodyは同じpublic IDを返し、別bodyは拒否した。owner-only/unlistedの固有文言が公開詳細・一覧・chunkへ漏れず、本人だけが原文を取得できた。限定roleの直接table参照とData APIの `app_private` 指定は拒否された。同じプール接続の次transactionではactorが `null`だった。

: 一時Next.jsサーバーで、公開GET前後のAuthユーザー数が不変でSet-Cookieもないこと、匿名POSTが1 UIDだけを作って既存Cookieを再利用すること、匿名Cookie付き作成から本人取得・公開詳細までの実BFF経路を確認した。

実行していない検証と理由:
: cloud Supabase projectは未接続のため、実projectのtransaction pooler、Auth redirect、CAPTCHA provider、cloud DB advisor、stagingドメインでのCookie/CAPTCHA E2Eは未実施。必要なrole作成、環境変数、Auth/Data API設定、適用コマンドは `docs/stage-b-setup.md` に記録した。

: 段階Bのローカル統合は直接Postgres接続上の小規模 `pg.Pool` でtransaction-local actorの破棄を検証した。cloudのSupavisor transaction modeは設定手順を整備したが、実project接続後に再確認が必要。

: 作成フォーム、本人画面、編集・削除、version競合、メールOTP/manual linkingの利用フローは段階C。Canvas、共有画像、通報・管理、共有レート制限運用も後続段階のため、現在の画面は保存成功を表示しない。

仕様からの変更と理由:
: 仕様の意味の変更はない。原子的な補助テーブル更新を直接権限なしで行うため、固定search path・完全修飾名・allow-list EXECUTEの限定 `SECURITY DEFINER` 関数境界を採用した。実装判断は `docs/decisions.md` のADR-B-001〜004へ記録した。

既知の問題・外部設定が必要な項目:
: cloudのproject URL/publishable key、`emanowa_app` の環境別secret、migration接続、CAPTCHA、正規origin、運営者・問い合わせ先は未設定。設定不足時は書き込みを拒否し、デモへ切り替えない。

: ローカルSupabaseがロール作成者へ持たせるADMIN所属は `inherit_option=false`・`set_option=false`であり、pgTAPでも `USAGE=false`・`SET=false`を確認した。通常BFF roleと所有者roleは試験終了時に `NOLOGIN`へ戻り、一時policyは削除される。

次に実装する段階:
: 段階C「絵馬の作成と本人管理」。入力・プレビュー・簡易場所選択を現在の作成APIへ接続し、本人画面、編集・削除、version競合、再送復帰、メールOTPによる同一UIDの引継ぎを実装する。

## 段階C — 絵馬の作成と本人管理

対象段階:
: P0 段階C「絵馬の作成と本人管理」（実装・ローカルDB/Auth/HTTP統合検証完了）

実装した体験:
: 願い、表示名、種類、表示番号、地図掲載範囲、本文公開範囲の入力から、地図・個別URL・共有画像相当の公開プレビュー、確認、保存、完了までを実BFFへ接続した。下書きと冪等キーはversion付きで同一タブのsessionStorageだけに保持し、保存時のopaqueな認証epochと復元時のepochが一致する場合だけ戻す。枠競合時も文面を残して近隣番号を案内する。閲覧だけでは匿名Authを作らない。

: `/me` で本人原本の取得、部分更新、version競合比較、削除、通信結果不明時の同一キー再送を実装した。更新・削除は検証済みUIDだけを使い、第三者には対象の存在を知らせない。削除は本文・表示名を抹消して枠を解放し、旧公開IDは墓標として再利用しない。本人年別一覧は厳格keyset cursorのAPIを用意した。

: 匿名UIDへ任意メールを追加するlink、既存メールへのOTP送信、用途別OTP検証、別Cookieでの復帰、local signoutを実装した。link前後のUID一致を確認し、既存メール競合では所有者を自動統合しない。ログアウトや別所有者への復帰時はフォーム、競合本文、冪等キー、タブ内下書きを消す。同じ絵馬への復帰を再取得で確認できた場合だけ未保存編集を保持する。

: Cloudflare Turnstileを匿名Authとメール復帰要求へ接続し、staging/productionの設定不足をfail closedにした。認証確認から投稿確定、本人GET・更新・削除、メール追加/復帰要求、OTP検証、ログアウトを同じWeb Lockでタブ間直列化し、未対応時は安全側で拒否する。認証変更は秘密を含まないdurableなpending/committed/cancelled eventで調整し、失敗時は下書きを保持、成功時だけepochを進める。古い本人応答はabortと世代・epoch照合で反映せず、タブ中断でpendingが残った場合は破棄確認付きの安全な復旧経路を表示する。IME変換確定Enter、多重送信、フォーカス移動、`aria-live`、reduced motionを扱う。

主な変更ファイル:
: `supabase/migrations/20261028072833_stage_c_owner_mutations.sql`、`supabase/tests/database/stage_c_owner_management.test.sql`、`supabase/templates/`、`src/server/auth/email*.ts`、`src/server/api/owner-worlds-cursor.ts`、`src/server/db/`、`src/server/ema/`、`src/app/api/v1/auth/`、`src/app/api/v1/me/`、`src/components/auth/turnstile-challenge.tsx`、`src/components/ema/`、`scripts/stage-c-integration.mjs`、`docs/stage-c-setup.md`

DB migration / 設定変更:
: owner更新・削除と本人年別一覧のexecute-only関数、version付き行ロック、immutable mutation receipt、公開投影・占有・chunk同期、本人一覧用partial indexを追加した。ローカルAuthのメール確認を有効にし、Magic LinkとChange Emailを6桁OTP表示のテンプレートへ固定した。

: `NEXT_PUBLIC_CAPTCHA_SITE_KEY` は公開allow-list、`CAPTCHA_SECRET_KEY` はサーバー専用の設定確認値とし、同じsecretをSupabase AuthのTurnstile providerへ設定する。staging/productionだけ必須で、development/testのローカルAuthは省略できる。実secret、SMTP資格情報、メールアドレス、OTPはコミットしていない。

検証した経路と結果:
: Node.js `24.17.0`、pnpm `11.25.0`でformat、ESLint、TypeScript、Vitest 18ファイル143件、本番ビルドに成功した。React品質確認では、第三者SDKの遅延読込、version付きstorage、秘密状態の最小保持、直接import、フォーカスとアクセシビリティを確認した。

: DB reset後のpgTAPは段階B 50件と段階C 58件の合計108件すべて成功した。owner PATCHの冪等性、version競合、第三者404、公開範囲縮小、DELETE抹消、枠解放後の新しい公開ID、RLS、execute-only権限を確認した。`app_private` のDB lintは警告を含め問題0件だった。

: 実Postgresで異なるUIDの同一枠100件同時要求は成功1件・`SLOT_TAKEN`99件、同じUIDの異なる枠は成功1件だけだった。実BFFでは独立Cookieの第三者PATCH/DELETE拒否、本人再取得、HTTP PATCH/DELETEの同一キー再送と別body拒否、削除後404、owner-only固有文言が公開JSON・HTML・RSCへ出ないことを確認した。匿名UIDを維持したメール追加、登録済み認証種別、別CookieのOTP復帰、無効OTP、既存メール競合、signoutも確認した。

: Turnstile tokenのサーバー検証契約、公開環境の設定不足503・新規匿名Authのtoken不足422・Supabaseへのtoken転送を単体試験で確認した。Web Lock helperのexclusive実行・未対応時fail closed・例外後解放、本人要求世代guardのabort・古い応答拒否、二相認証eventの成功commit・HTTP失敗/network例外cancel・中断時の明示commit・永続epoch・重複排除・focus再照合、epoch不一致下書きの拒否を単体試験で確認した。作成・本人画面が同じhelper内でbody読了まで行いstate反映前に世代とdurable epochを再照合することは型検査とコードレビューで確認し、実ブラウザー2タブ検証は未実施項目に残した。Turnstile widget自体の実ブラウザ確認も外部設定後の残件である。

実行していない検証と理由:
: cloud Supabase project、SMTP、Turnstile provider、本番/stagingドメインは未接続のため、実cloudのメール到達性、CAPTCHA challenge検証、Supavisor接続、複数端末のCookie/OTP E2Eは未実施。実ブラウザー2タブでのWeb Locks・BroadcastChannel連携、Aの応答を保留したままBへ復帰・ログアウトしてAの応答が非反映になるReact結線も、純粋契約とコードレビューまでで外部設定後の確認が必要。設定と確認手順は `docs/stage-c-setup.md` に記録した。

: 360/390/768/1440pxの実ブラウザ視覚確認とスクリーンリーダー実機確認は未実施。CSS、focus-visible、44px操作領域、IME抑止、ARIA、reduced motionは静的検査とコードレビューで確認した。Canvas地図は段階Dのため、段階Cは仕様どおり番号・座標の簡易選択を使う。

仕様からの変更と理由:
: 仕様の意味の変更はない。本人mutation、認証後の秘密状態、タブ間匿名Auth、CAPTCHAの実装判断は `docs/decisions.md` のADR-C-001〜004へ記録した。CAPTCHA UIは段階Fの不正利用対策を前倒しし、公開環境で段階Cの匿名投稿・復帰が設定済みでも必ず失敗する状態を残さないために接続した。

既知の問題・外部設定が必要な項目:
: 未投稿下書きには所有者を安全に照合できる作品IDがないため、OTP復帰時は前利用者への漏えい防止を優先して破棄する。投稿済み絵馬の未保存編集は、同じpublic IDへの復帰を確認できる場合だけ保持する。

: cloudのproject URL/publishable key、`emanowa_app` transaction-pooler secret、migration接続、Turnstile site/secret、正規origin、本番SMTP、運営者・問い合わせ先は未設定。共有レート制限、通報、管理者の非表示・復帰は段階F、Canvas地図は段階D、共有画像と招待は段階Eの対象。

次に実装する段階:
: 段階D「地図と探索」。Canvasの移動・ズーム、疎なチャンク取得、集計表示、一覧代替、番号移動、ランダム訪問、自分の絵馬への移動を、公開範囲を維持したまま実装する。
