# 実装状況

更新日: 2026-10-29

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

## 段階D — 地図と探索

対象段階:
: P0 段階D「地図と探索」（実装・ローカルDB/Auth/HTTP統合検証完了）

実装した体験:
: `/w/{worldSlug}` をCanvas地図へ接続した。マウスドラッグ、タッチのパン・ピンチ、ホイール、拡大縮小ボタン、全体表示、中心復帰、位置URL、DPR最大2の描画に対応する。カメラは `centerX` / `centerY` / `cellPx` を持ち、URL、直前のsessionStorage、公開絵馬が集まり空きもある集計領域、中央の順に初期位置を決める。6 CSS px以内をタップとし、空き、公開絵馬、識別子を持たない占有、未取得を区別する。

: 縮尺に応じて100×100集計、20×20集計、個別の絵馬形状、公開可能な本文へ切り替える。可視範囲と最大1チャンクの先読みを最大16チャンク、同時4要求、200ms待ちで取得し、広すぎる近景は集計へ戻す。要求世代とAbortControllerで古い応答を破棄し、非表示タブでは描画・取得を止める。復帰時は公開キャッシュを破棄して再取得し、チャンクと一覧の保持量も制限する。未取得・失敗した範囲は空きと扱わない。

: 公開一覧はAPI既定24・最大50件の新着keysetページング、カテゴリー絞込み、ランダム訪問を実装した。UIは24件ずつページを置き換えて任意の深さまで進み、現在ページのcursorを30秒間隔で再取得するため、全件をDOMやメモリへ蓄積しない。表示番号からの移動、一覧から地図への移動、所有者用APIをWeb Lockと認証epoch内で読む「自分の絵馬」、矢印/Shift+矢印、`+` / `-`、Enter、Escapeを用意した。Canvas外のHTMLに選択番号と操作を表示し、Canvasが使えない場合も一覧から閲覧・作成へ進める。

: 地図で確認済みの空き枠から作成画面へ `x` / `y` を渡し、既存の本文・設定を保ったまま選んだ場所を作成フローへ反映する。この時点では予約せず、段階B/Cの原子的な確定処理で同一枠・同一所有者の競合を再検証する。

: 公開詳細から「地図で見る」を選ぶと作品座標の `z=80` へ移動する。編集URLはqueryの期待public IDと本人APIから取得したOwnerEmaのpublic IDが一致する場合だけ編集画面を表示し、別作品・所有者切替・古いURLでは本人原文を表示しない。

主な変更ファイル:
: `supabase/migrations/20261028101056_stage_d_map_exploration.sql`、`supabase/tests/database/stage_d_map_exploration.test.sql`、`src/app/api/v1/worlds/[slug]/overview/`、`chunks/`、`emas/`、`src/components/world/`、`src/domain/`、`src/server/api/public-ema-cursor.ts`、`src/server/db/queries.ts`、`src/server/ema/`、`scripts/stage-d-integration.mjs`、`docs/stage-d-setup.md`

DB migration / 設定変更:
: 20/100枠の公開概要、チャンクmetadata、索引付きランダム探索のexecute-only関数を追加した。チャンクmetadataとセルの関数を `STABLE` とし、同じ呼出しSQL文のスナップショットでrevisionと全セルを返す。占有チャンクの式索引、公開UUID pivot索引、カテゴリー付き公開UUID pivot索引を追加し、通常BFF roleだけへ固定関数のEXECUTEを許可した。公開詳細用のlookup文脈や所有者情報を引数にせず、RLS・NOBYPASSRLS・Data API非公開の境界を維持する。

: 外部環境変数や新しい外部サービスは追加していない。cloudでは既存のmigration接続で段階D migrationを適用し、通常APIは引き続きtransaction poolerの `emanowa_app` だけを使う。overviewを除く公開応答は `no-store`、overviewは内容なし統計として `s-maxage=30` 以下に限定する。

検証した経路と結果:
: 純粋関数とDTOの試験に、カメラ変換、縮尺、チャンク上限、場所URL、保存カメラ、初期領域、公開一覧、厳格cursor、UTF-8応答上限、概要・チャンクmapperを追加した。Node.js `24.17.0`、pnpm `11.25.0`で `pnpm check` が成功し、format、ESLint、TypeScript、Vitest 24ファイル196件がすべて成功した。本番production buildも成功した。

: DB reset後のpgTAPは、段階Bのcontext 2件・private schema 48件、段階C 58件、段階D 48件、合計156件がすべて成功した。段階Dでは限定roleのEXECUTE、PUBLIC系roleの拒否、固定search path、関数のSTABLE契約、索引、20/100集計、revision=0の空チャンク、不明world、最大400セル、unlisted/hiddenの識別子なし占有、owner-only本文NULL、一覧category/keyset、DB精度cursor、ランダムpivot、入力上限を確認した。段階B/CのHTTP回帰も成功し、異なるUIDの同一枠100件同時要求は成功1件・`SLOT_TAKEN`99件で、既存の所有権・同時投稿制約を維持した。

: production serverを使う段階D HTTP統合はすべて成功した。公開1,000件・密集400件・unlisted・hidden・owner-only・空worldのfixtureで、overview 20/100、400件チャンクのrevisionと非圧縮サイズ、24/50件一覧とcursorのworld/category拘束、ランダム候補、空集合を確認した。公開JSON・HTML・実RSC payloadに非公開fixture文言はなく、全公開GET前後でAuthユーザー数は不変、Set-Cookieもなかった。

: 同じローカルproduction serverへ各15回要求した実測は、密集400件チャンクがp50 `109.47 ms`・p95 `114.61 ms`・最大 `155,394 bytes`、20枠概要（占有1,002件）がp50 `7.73 ms`・p95 `22.54 ms`・最大 `345 bytes`、公開1,000件中50件の一覧がp50 `13.91 ms`・p95 `26.43 ms`・最大 `18,236 bytes` だった。密集チャンクは通常目標の非圧縮512 KiBと保護上限4 MiBを下回った。これはローカルNode/Postgresの基準値であり、実ブラウザーの描画fpsやcloud RTTの代用にはしない。

実行していない検証と理由:
: cloud Supabase projectとstagingドメインは未接続のため、実Supavisor、cloud DB advisor、CDNのoverview最大30秒、cloud RTT/LCPは未確認。migration・role・cache header・EXPLAIN・公開範囲の確認手順を `docs/stage-d-setup.md` に記録した。

: 360/390/768/1440pxの実ブラウザー視覚確認、マウス・実機タッチ/ピンチ、Safari/Chrome、スクリーンリーダー、`prefers-reduced-motion`、10秒の密集地図移動で継続30fpsの計測は未実施。Canvasの純粋計算、要求上限、レスポンシブCSS、キーボード経路、HTML一覧は実装・静的検査済みだが、これらは実ブラウザーで確認が必要。

仕様からの変更と理由:
: 仕様の意味の変更はない。遠景・近景のDB境界、Canvasの一時状態、可視復帰時の破棄、公開一覧のDB精度cursor、索引付きランダム探索は `docs/decisions.md` のADR-D-001〜003へ記録した。

既知の問題・外部設定が必要な項目:
: cloudのproject URL/publishable key、`emanowa_app` transaction-pooler secret、migration接続、Turnstile、正規origin、本番SMTP、運営者・問い合わせ先は引き続き未設定。設定不足時は書込みを拒否し、地図閲覧のために匿名Authを作ったりデモへ切り替えたりしない。

: 近くへの招待、OG/共有PNG、X・LINE共有は段階E、共有レート制限、通報、管理者の非表示・復帰は段階Fの対象。位置URLは公開地図の場所だけを共有し、unlisted作品の識別子やアクセス権を付与しない。

次に実装する段階:
: 段階E「共有と近くへの招待」。既存の個別URLと地図位置を基に、公開投影だけを使うOG/共有PNG、共有入口、最大20枠の近隣候補を実装する。

## 段階E — 共有と近くへの招待

対象段階:
: P0 段階E「共有と近くへの招待」（実装・ローカルDB/Auth/HTTP/画像統合検証完了）

実装した体験:
: 安定した個別URLへ、共有内容を事前確認できるdialog、X Web Intent、LINE共有画面、通常/招待URLコピー、Clipboard拒否時の選択欄、正方形PNG保存を追加した。共有先を選んだ時点では「投稿/送信画面を開いた」とだけ案内し、自動投稿や完了表示をしない。共有文章には願い本文を自動挿入せず、設定済みoriginと固定pathだけからURLを作る。

: 個別ページへcanonical、OG、Twitter metadataを追加し、1200×630のOGと1080×1080の保存用PNGを実装した。公開投影だけをrendererへ渡し、`owner_only`本文は固定文にする。public/unlistedからowner-only/hidden/deletedへ変化した場合に古い画像を返さないよう、描画前後でversionを照合して再描画または404/503にする。詳細と招待元は30秒間隔・タブ復帰時に公開状態を再取得し、縮小・削除・確認失敗時は旧本文をfail-privateで隠す。

: 静的CFF版Noto Sans JPをOFL・出典・SHA-256付きで同梱し、実行時の外部font/emoji CDNを不要にした。80書記素と改行を切り捨てず、OGは20字×4行、正方形は16字×5行へ収める。外部emoji fontがなくても生成を失敗させず文字を黙って消さないため、画像内だけemoji graphemeを`◇`と凡例へ決定的に置き換える。

: `/api/v1/worlds/{slug}/nearby` と非公開DB関数を追加した。正確なpublic/unlisted招待元または座標の周囲をChebyshev半径3、8、20の順で最大41×41だけ調べ、空き候補を最大8件、距離二乗・表示番号順で返す。候補は予約せず自動選択せず、本人が選ぶ。保存時は既存の原子的制約で空きと年1枚を再確認し、`SLOT_TAKEN` は下書きを残して候補を再取得する。

: 招待landingは閲覧だけでAuthやCookieを作らず、入力/確定の明示操作後にだけ匿名Authを作る。既に同年の絵馬があるsessionでは本人APIの最小状態だけを読み二枚目を止める。無効、hidden、deleted、別world、候補0件、満杯、受付停止を有限表示し、成功後は招待元と自分の2点を同じ地図で確認できる。

: P0の7計測点をprovider-neutralな`emanowa:measurement` eventへ接続した。runtime allow-listでpayloadを再構築し、年、共有先、通常/招待の区別以外を除去するため、本文、表示名、メール、公開ID、URL、token、Cookieを分析eventへ渡さない。未接続やlistener失敗は主操作を止めない。

主な変更ファイル:
: `supabase/migrations/20261029024520_stage_e_sharing_nearby.sql`、`20261029030052_stage_e_world_lock_policy.sql`、`supabase/tests/database/stage_e_sharing_nearby.test.sql`、`src/app/api/v1/worlds/[slug]/nearby/`、`emas/[id]/image/`、`src/server/share/`、`src/components/ema/ema-share-panel.tsx`、`ema-detail-live.tsx`、`new-ema-flow.tsx`、`src/components/analytics/public-measurement.ts`、`assets/fonts/`、`scripts/stage-e-integration.mjs`、`docs/stage-e-setup.md`

DB migration / 設定変更:
: `get_nearby_slots` は `app_private`、固定search path、`STABLE SECURITY DEFINER`、`NOBYPASSRLS`所有者とし、EXECUTEは`emanowa_app`だけへ付与した。unlistedはtransaction-localの正確なlookup UUIDだけで解決し、hidden/deleted/別worldを返さない。`create_ema`の`SELECT ... FOR SHARE`がFORCE RLS下でworld行を取得するために必要な`worlds_owner_update_lock` policyを追加した。通常BFF roleはworld tableを直接更新できず、所有者roleは通常`NOLOGIN`のままである。

: 新しい秘密値や外部サービスは追加していない。`APP_ORIGIN` はuserinfo、path、query、fragmentを含まないbare HTTP(S) originだけを受理するよう強化した。共有画像fontは `NotoSansJP-Regular.otf`、SHA-256 `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073` で固定した。

検証した経路と結果:
: Node.js `24.17.0`、pnpm `11.25.0`で `pnpm check` が成功し、Prettier、ESLint、TypeScript、Vitest 32ファイル223件がすべて成功した。Next.js `16.4.3`のproduction buildも成功した。画像renderer単体でOGは577ms、正方形は288msのローカル実行で正しいPNG寸法を返した。これは初回ローカル値であり本番性能保証ではない。

: クリーンDBから `pnpm test:stage-e` を実行し、段階B context 2件・private schema 48件、段階C 58件、段階D 48件、段階E 30件、合計186件のpgTAPが成功した。DB lint、段階B〜DのAuth/HTTP/同時投稿回帰も成功し、異なるUIDの同一枠100件は成功1件・`SLOT_TAKEN`99件だった。試験専用world UPDATE policyを削除しても投稿が成功し、恒久RLS policyを実際に通ることを確認した。

: 段階Eproduction server統合ではnearbyの厳格query、最大8件・順序・半径、public/unlisted/owner-only/hidden/deleted/別world、HTML・RSC・metadata・画像、`no-store`、検索抑止、Cookie非発行、Authユーザー不増を確認した。同じ画像URLを公開縮小・削除後に再取得して古い本文/bytesを返さないこと、別Cookieの招待→明示匿名Auth→投稿→同world内2点、年1枚、同一候補2人の成功1件・`SLOT_TAKEN`1件も成功した。

: 80書記素、日本語、改行、絵文字を実endpointでOG/正方形PNGへ生成し、signature/IHDRを自動確認した。原寸画像を目視して本文、カード、footerに枠外表示・clip・文字欠けがないこと、emoji markerと凡例が表示されることも確認した。

実行していない検証と理由:
: cloud Supabase、stagingドメイン、CDN、実X/LINEアプリ、SNS crawler、analytics collectorは未接続のため、実Supavisor、CDNの`no-store`/`X-Robots-Tag`、OG展開、実投稿/送信画面、collectorへのevent送信は未確認。設定・確認手順は `docs/stage-e-setup.md` に記録した。

: 360/390/768/1440px、実iOS/AndroidのClipboard拒否・画像保存・LINE/X WebView、dialog focus、キーボード、スクリーンリーダーの実機確認は未実施。レスポンシブCSS、44px操作領域、label、live region、focus経路、React hooksは静的監査済みだが、代表端末での最終確認が必要。

仕様からの変更と理由:
: P0の意味の変更はない。emojiは画像生成の外部依存と全体失敗を避けるため画像内だけ明示markerへ置換し、原文は変更しない。公開画像、近隣候補、計測境界の判断は `docs/decisions.md` のADR-E-001〜003へ記録した。

既知の問題・外部設定が必要な項目:
: 実SNS/collector/cloud設定は未設定。X/LINE clickを投稿/送信完了として計測しない。実collector接続時もallow-list外の本文、表示名、メール、公開ID、URL、token、Cookieを送らない監査が必要。

: 共有レート制限、通報、運営による非表示・復帰、監査記録は段階F、ブラウザー性能・障害回復の全試験表は段階G、公開環境のCDN/監視/バックアップは段階Hで扱う。

次に実装する段階:
: 段階F「通報・運用・不正利用対策」。通報、管理者の非表示・復帰、監査記録、複数instanceで共有するrate limit、CAPTCHA運用を実装する。

## 段階F — 通報・運用・不正利用対策

対象段階:
: P0 段階F「通報・運用・不正利用対策」（実装・ローカルDB/Auth/MFA/複数instance統合検証完了）

実装した体験:
: 公開詳細へ通報dialogを追加し、列挙された理由と任意の200書記素・UTF-8 2KiB以内の補足だけをplain textとして受け付ける。同じ利用者・同じ絵馬の未解決通報は1件に集約し、同じ冪等keyの再送は同じreceipt、別keyの重複は既存report IDを返す。通報件数だけで作品を自動非表示にせず、入力、冪等key、429の再試行時刻を画面に保持する。

: 作成10回/分、編集30回/10分、通報5回/時、画像30回/分、OTP送信は同一宛先へ要求時刻から連続60秒、OTP確認はメール追加5回/10分、復帰確認は信頼済み送信元全体30回/10分、正規化宛先全体30回/10分、宛先＋送信元の組ごと5回/10分を、複数instanceで共有するPostgres bucketへ実装した。作成・編集・通報は検証済みUID、画像は信頼済みproxy chainから得た送信元、OTP送信はNFC・小文字化した宛先、メール追加確認はfresh匿名UID、復帰確認は信頼済み送信元、正規化宛先、正規化宛先＋送信元の三つを使い、action別HMAC-SHA-256だけを保存する。信頼済み送信元は同じIPv6の圧縮・展開表記を一つにし、IPv4-mapped IPv6を同じIPv4 subjectへcanonicalizeする。復帰確認の三層は専用DB関数が1 transactionと決定的なadvisory lock順序で原子的に判定し、枯渇した軸だけを更新する。メール追加だけは `otp_verify_link` を汎用関数で消費する。OTP送信はopaqueな要求UUIDで予約し、CAPTCHA拒否等の送信前失敗だけ一致予約を解放する。上限超過は429と `Retry-After`、store・HMAC・proxy設定障害時の変更要求は503で閉じ、公開閲覧は継続する。

: `/admin` と管理APIを、検証済みclaims、同じUIDのfresh Auth user、非匿名・確認済みメール、Supabase TOTPのAAL2、有効なDB管理者台帳の積で保護した。TOTP enrollment、QR/秘密鍵の一時表示、challenge/verify、通報keyset一覧、絵馬の非表示・復帰・削除、通報の解決・却下を実装した。QR、秘密鍵、6桁code、factor/challengeをURL、Web Storage、計測、ログへ保存しない。画面gateと各APIは独立して認可し、通常DB接続と管理DB接続を分離する。

: hideは公開投影だけを外して本人枠と占有を保持し、restoreは現在の公開設定から投影を再作成し、deleteは本文・表示名を抹消して投影・占有を削除する。原本、投影、占有、chunk集計、version、冪等receipt、監査を同じtransactionで更新する。監査には管理者UID、内部対象ID、action/reason、前後状態、時刻だけを残し、本文、表示名、通報補足、メールを保存しない。

: 管理者台帳をUUIDで有効化・無効化するCLIを追加した。確認済みメール、非匿名、未削除、非banをDB内で確認し、専用provisionerの一時membership、actor設定、台帳更新、revokeを1 transactionで行う。通常/admin/owner/provisioner接続を拒否し、全DB URLへusername、password、host、port、databaseの明示を必須にした。remote接続はTLS設定だけをallow-listしてhost、role、password、port、options、timeoutのquery上書きを接続前に拒否する。通常/admin実行時poolと管理CLIはraw URLをdriverへ渡さず構造化configへ変換し、ambient `PG*` を遮断しながらSupavisorの完全なusernameを保持する。ロールprovisioning、受付停止、CAPTCHA、proxy、MFA、障害時の設定・確認手順を `docs/stage-f-setup.md` に記録した。

主な変更ファイル:
: `supabase/migrations/20261029032612_stage_f_moderation_rate_limits.sql`、`supabase/tests/database/stage_f_moderation_rate_limits.test.sql`、`src/server/rate-limit/`、`src/server/reports/`、`src/server/admin/`、`src/app/api/v1/admin/`、`src/app/api/v1/worlds/[slug]/emas/[id]/reports/`、`src/components/admin/`、`src/components/ema/ema-report-panel.tsx`、`scripts/manage-admin.mjs`、`scripts/stage-f-integration.mjs`、`docs/stage-f-setup.md`

DB migration / 設定変更:
: `reports`、`admin_users`、`moderation_audit`、`rate_limit_buckets` と索引・制約を追加した。通報作成、共有rate limit、管理一覧、作品moderation、通報状態変更を固定search pathのexecute-only関数にし、値のallow-list、現在のactor/admin、expected version、冪等性を関数内でも再確認する。OTP送信はsubject単位のtransaction advisory lockで空行競合を閉じる。復帰確認の専用関数は、送信元全体30回/600秒、宛先全体30回/600秒、宛先＋送信元の組5回/600秒を1 transactionで決定的にlockして判定し、組の枯渇時は組だけ、広域軸の枯渇時は該当軸だけを更新して他のbucketを作らない。三つの復帰actionは汎用関数のallow-listから外し、専用関数との競合更新を防いだ。汎用関数の確認actionはメール追加用 `otp_verify_link` だけである。期限切れbucketは `expires_at` 索引から最大100件を `SKIP LOCKED` で回収する。

: 通常BFF `emanowa_app` と管理BFF `emanowa_admin_app` は別secret・別poolとし、private tableの直接権限や相互の関数権限を持たせない。`emanowa_admin_provisioner` は管理者台帳の必要列だけ、`emanowa_owner` はobject所有だけに限定し、両者を常時 `NOLOGIN` とする。限定4ロールの親membershipもmigrationで除去し、`SET ROLE` 経路を閉じた。migration secretはruntime設定から除外した。`ADMIN_DATABASE_URL`、`RATE_LIMIT_HMAC_SECRET`、`TRUSTED_PROXY_HOPS` を設定契約へ追加し、公開環境は不足・不正値をfail closedにする。developmentでもHMAC secretは必須とした。

検証した経路と結果:
: Node.js `24.17.0`、pnpm `11.25.0`で `pnpm check` が成功し、Prettier、ESLint、TypeScript、Vitest 45ファイル322件がすべて成功した。Next.js `16.4.3`のproduction buildも成功し、`.next/static`、公開HTML/RSCへ通常/admin/migration DB、service role、rate-limit秘密が含まれないことを確認した。

: クリーンDBから `pnpm test:stage-f` を実行し、段階B context 2件・private schema 48件、段階C 58件、段階D 48件、段階E 30件、段階F 74件、合計260件のpgTAPが成功した。`app_private` のDB lintはwarningも失敗扱いで問題0件だった。段階B〜EのAuth、所有権、同時投稿、本人管理、地図、共有、招待回帰もすべて成功した。

: 2つのproduction Next.js instanceへ交互・並行に要求し、作成・編集・通報・画像・OTP送信/確認の共有上限、画像31件並行時の許可30・拒否1とDB count 31、OTP送信の連続60秒予約、復帰確認の同一宛先＋送信元で6件目の429、同一送信元で宛先を切り替えた31件目の429、送信元を切り替えても同一宛先では31件目の429、別の宛先と送信元の独立性、拒否時の保存内容・version/Auth不変を確認した。DB bucketも照合し、組の枯渇では組だけ、送信元全体・宛先全体の枯渇では該当する広域軸だけが更新され、ローテーションした新しい組や他軸を作らないこと、汎用関数が復帰actionを拒否することを確認した。IPv6の同値な圧縮・展開表記とIPv4-mapped IPv6も同じ送信元subjectになることを確認した。rate-limit関数のEXECUTEを一時revokeした状態では公開JSONを読める一方、変更要求は503で保存せず、grant復旧後に再開した。

: 実ローカルSupabase Authで確認済み登録ユーザーへTOTPをenroll・challenge・verifyし、SSR CookieのAAL2 sessionだけが管理APIを利用できた。未認証、一般利用者、AAL1、有効台帳にないAAL2、無効化直後の管理者は拒否された。CLIのenable、disable直後403、再enableを確認し、remote TLS未指定・重複`sslmode`・host/timeout query上書きの接続前拒否も試験した。

: 通報201・同一key/別keyの並行収束・冪等再送・未解決重複集約、危険なHTML文字列のplain-text応答、自動非表示なし、管理一覧への通報者UID・owner-only本文・内部ID非露出を確認した。hideの異なるkeyによる並行version競合、restore/deleteと通報解決、冪等競合、公開詳細/一覧/random/nearby/chunk/HTML/RSC/metadata/OG/正方形PNGの即時反映、監査への本文非保存とhide監査1件を実endpointとDBで確認した。Next.jsのRSC not-foundはHTTP 200のsoft-404もあるため、Flightの `NEXT_HTTP_ERROR_FALLBACK;404` とUGC非含有を検証した。

実行していない検証と理由:
: cloud Supabase、stagingドメイン、CDN/reverse proxy、Turnstile、SMTP、本番MFA factorは未接続のため、実Supavisor、providerのDB SSL enforcement、実header chainの `TRUSTED_PROXY_HOPS`、cloud複数instance、Auth/provider側rate limit、メール到達性、CDNの非保持は未確認。必要な設定と確認表は `docs/stage-f-setup.md` に記録した。

: 360/390/768/1440px、実認証アプリでのTOTP QR、dialog focus、キーボード、スクリーンリーダー、代表端末での視覚確認は未実施。CSS、ARIA、focus経路、React hooks、秘密状態の保持境界は静的監査済みだが、stagingと実機で最終確認が必要。

: 管理当番、問い合わせ先、一次対応時間、違法・緊急内容のエスカレーション、backup復旧後の再非公開化、管理者factor復旧は公開前の運用合意が必要。リポジトリでは受付停止、台帳即時無効化、migration/アプリrole分離の手順まで整備した。

仕様からの変更と理由:
: P0の意味の変更はない。共有bucketを正本にするfail-closed制限、OTPの連続60秒予約と限定rollback、fresh Auth・AAL2・DB台帳・専用接続を積にする管理権限、通報と作品moderationの分離は `docs/decisions.md` のADR-F-001〜003へ記録した。作成等の固定時間窓試験はPNG生成時間で境界を跨がないよう、実画像1件とrate判定後に404となるfixtureを組み合わせ、製品制限値は変更していない。

既知の問題・外部設定が必要な項目:
: `RATE_LIMIT_HMAC_SECRET`、正確な `TRUSTED_PROXY_HOPS`、通常/admin DB secret、migration/DBA接続、管理者Auth UUID、Turnstile、SMTP、運営者情報、問い合わせ先は環境ごとに設定が必要。設定不足時は変更要求を拒否し、process内Map、demo、通常DB接続、AAL1へフォールバックしない。

: 実providerで管理者をbanする場合はAuthだけでなく管理者台帳もdisableし、unbanだけで管理権限を復帰させない。通常/adminアプリroleだけをprovisioning時にLOGIN化し、owner/provisionerへ資格情報を与えない。remoteの管理CLIはTLSとquery allow-listを満たすmigration/DBA endpointだけを使う。

次に実装する段階:
: 段階G「品質と障害回復」。全試験表、ブラウザー性能・アクセシビリティ、ネットワーク切断・再送・認証切替・DB/Auth障害、backup/restoreを含む回復経路を検証する。
