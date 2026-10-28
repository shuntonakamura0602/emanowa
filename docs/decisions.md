# 実装上の判断記録

仕様の意味を変える判断は、関連する仕様パートも合わせて更新する。このファイルでは、段階Aで選んだ実装上の表記・境界を記録する。

## ADR-A-001: `FEATURED_WORLD_SLUG` を環境変数名にする

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 01 §6.1、09 §4

仕様中の設定名 `featured_world_slug` は概念名として扱い、環境変数では既存の大文字スネークケースに合わせて `FEATURED_WORLD_SLUG` とする。値を公開してよいことと、設定元をサーバーが管理することは変えない。空欄時はリポジトリで定義済みの `2027` を選び、現在の西暦から推測しない。未定義slugは設定エラーとして記録し、任意のworldを生成しない。

## ADR-A-002: 実行環境を `NODE_ENV` と分離する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 07 段階A・H、09 §4

Next.js はローカルの `next build` でも `NODE_ENV=production` を使用するため、公開先の意味まで `NODE_ENV` だけで判定しない。`EMANOWA_ENVIRONMENT=development|test|staging|production` を追加し、開発サーバーの空欄は development とする。ただし `NODE_ENV=production` で未指定なら設定errorとして書込みを停止する。本番公開では production、stagingでは staging を必ず明示する。

## ADR-A-003: デモデータは永続化adapterにしない

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 00 共通契約8、07 段階A、09 §4

`pnpm demo:seed` は無視対象の `.demo/ema-fixtures.json` に、表示確認用と分かる固定サンプルだけを作る。段階Aの実行時アプリはこのfixtureを本番保存の代わりにしない。staging/productionでは作成・削除を拒否し、DB設定不足時もデモへ暗黙に切り替えない。

## ADR-A-004: クライアント設定はallow-listで組み立てる

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §1・§7、09 §4

サーバー設定オブジェクト全体をClient Componentへ渡さず、`src/config/public.ts` の明示的なallow-listで公開設定を再構築する。Supabase URL、publishable key、CAPTCHA site key、検証後のworld、機能可否、接続状態だけを公開対象にする。DB URL、migration URL、CAPTCHA secret、HMAC secret、運営の未公開値は含めない。

## ADR-A-005: 段階Aのworld状態は固定fixtureとして扱う

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 01 §6、04 §3、07 段階A・B

`WORLD_2027` は段階Aの画面・契約検証用で、受付開始・終了のUTC時刻、1000×1000、中心 (500, 500)、`basic_wood` を保持する。可変のstate、`posting_enabled`、DB現在時刻による `acceptingPosts` の正本にはしない。段階BでPostgresへ移し、新規投稿の最終判定は同一transaction内のDB時刻で行う。

## ADR-A-006: 互換性を実測した依存バージョンを固定する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §1・§14、07 段階A、09 §2・§6

Next.js `16.4.3`、React/React DOM `19.3.1`、`@supabase/supabase-js` `2.118.0`、`@supabase/ssr` `0.12.7`、Zod `4.6.7` を採用し、`pnpm-lock.yaml` に固定する。Supabase JSの現行サポートとVitestの要件を合わせ、プロジェクトのNode.js下限は `22.12.0`、検証ランタイムは `24.17.0` とする。

TypeScriptのレジストリ最新は7系だったが、Next.js `16.4.3` が解決する `@typescript-eslint/parser` のpeer範囲は `<6.1.0` であり、実際のlintで非互換を確認した。このため互換範囲内の最新安定版 `6.0.3` を採用した。バージョン更新時はNext.js同梱ドキュメント、Supabase changelog、peer dependency、lint/typecheck/test/buildを再確認する。

## ADR-B-001: 非公開schemaはexecute-onlyの内部関数境界にする

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §1・§5・§6・§9、07 段階B

`app_private` をSupabase Data APIへ公開せず、`PUBLIC`、`anon`、`authenticated`、`service_role` からschema・table・function権限を剥奪する。テーブルは `emanowa_owner` が所有し、通常BFFの `emanowa_app` はallow-listした関数のEXECUTEだけを持つ。すべてのテーブルでRLSを有効化・強制し、所有者原本はtransaction-localのactorと一致する行だけを対象にする。

原子的な配置では原本、占有、公開投影、chunk集計、冪等receiptを同時に更新する必要がある。通常ロールへ補助テーブルの直接権限を広げないため、内部関数は仕様が許容する限定的な `SECURITY DEFINER` とする。関数は `search_path=''`、完全修飾名、検証済みactorの必須確認、固定引数・戻り列、PUBLIC系roleからのEXECUTE revokeを持つ。公開一覧とURL限定の直接取得は別関数とし、公開投影にはowner-only本文を保存しない。

## ADR-B-002: アプリ用roleの秘密はmigrationに入れない

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §1・§6、07 段階B・H

migrationは `emanowa_app` を `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS` で作る。固定パスワード、cloud接続文字列、project固有値はコミットしない。ローカルでは `pnpm db:local-role` と統合試験がランダムな一時パスワードを設定し、cloudではmigration適用後に管理接続から環境専用secretを設定する。

アプリ設定は `DATABASE_URL` のrole名を検査し、`emanowa_app` 以外を通常APIに使用させない。remoteはtransaction-mode pooler、migration・backup・restoreは分離した直接接続を使う。

## ADR-B-003: 認証文脈はCookieやSQL sessionへ永続化しない

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §4・§6・§13、07 段階B

Supabase SSRクライアントをリクエストごとに作り、認可UIDは `getClaims()` の検証済み `sub` だけから取得する。匿名ユーザーも `authenticated` roleになるため、role名だけを本人性に使わない。BFFは各DB処理でBEGINした後、パラメーター付き `set_config('app.actor_id', uid, true)` と必要時だけ `app.lookup_public_id` を設定し、COMMIT/ROLLBACK後に同じ接続へ値を残さない。

匿名サインインは明示的な `/api/v1/auth/anonymous` POSTだけで開始する。既存の有効セッションは再利用し、未検証・壊れたCookieを新しい匿名UIDへ置き換えない。公開GETと通常の画面閲覧は匿名Authを作成しない。

## ADR-B-004: 段階BのDB toolingを固定する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §1・§14、07 段階B

直接Postgres接続に `pg 8.23.1`、型に `@types/pg 8.23.1`、ローカル再現とmigration/pgTAPにSupabase CLI `2.122.0` を固定した。通常クエリはnamed prepared statementを使わず、transaction poolerで同一transaction内のactor文脈だけを利用する。CLI操作は採用版の `--help` と公式migration手順を確認し、migrationファイルは `supabase migration new` で生成した。

## ADR-C-001: 本人更新・削除をversion付きexecute-only関数にする

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §5・§8・§9、07 段階C・RACE-05・RACE-08

PATCHとDELETEは、検証済みactor、`expectedVersion`、Idempotency-Keyとrequest hashを受ける固定search pathの内部関数で実行する。対象行をロックし、原本・占有・公開投影・chunk集計・immutable receiptを一つのtransactionで更新する。第三者には存在を知らせない404相当、古いversionには409を返し、同じキーと同じ内容は確定済み結果を返す。

削除は復元操作ではなく、本文と表示名を消去して枠と一枚制限を解放する。公開IDとtombstoneは保持し、旧URLを別作品へ再利用しない。

## ADR-C-002: メール引継ぎは同一UIDを確認し、復帰後の画面状態はfail-privateにする

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 02 §8、04 §4.2・§8.1、07 段階C・FLOW-08

匿名利用者へのメール追加は現在の匿名セッションに対する `updateUser({ email })`、別端末の復帰は `signInWithOtp` の `shouldCreateUser:false` と用途別 `verifyOtp` を使う。linkでは確認前後のUID一致を再確認し、不一致や既存メール競合時に所有権を移動・統合しない。

認証切れからの復帰時は、復帰前後で同じ本人用 `publicId` を取得できた場合だけ未保存フォームと同一冪等再送を保持する。別作品・作品なし・不正応答・通信失敗など同じ所有者だと確認できない場合は、競合本文、フォーム、冪等キー、タブ内下書きを消す。未投稿下書きには照合できる作品IDがないため、OTP復帰時は秘密情報の残留防止を優先して破棄する。

## ADR-C-003: 匿名Authはタブ間排他し、公開環境の入口にTurnstileを置く

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §4.1・§8.1、07 段階C・F

初回の匿名Authは、ブラウザー内のPromiseだけでなく、同一originのWeb Locksで直列化する。localStorageには原子的なcompare-and-swapがなく、安全なleaseを保証できないため排他の代用にはしない。Web Locks未対応時は未ロックで新しいUIDを作らず再試行を案内する。認証確認から投稿確定までに加え、本人GET・更新・削除、メール追加/復帰要求、OTP検証、ログアウトも同じロックへ参加させ、Cookieを書き得る応答はbody読了までロック内で処理する。本人要求はabort可能な世代番号を持ち、認証変更後に旧Cookieの応答が遅着してもReact stateへ反映しない。

復帰・ログアウト・メール確認は、UID等を含まない二相eventをdurable storageへ記録する。Auth要求前の `pending` で各タブは本人限定表示を一時的に隠すが、下書きと未保存編集は保持する。安全な応答本文まで受信し、認証文脈が変わった場合だけopaqueなepochを進めて `committed`、無効OTP・通信失敗・失敗したログアウト・同じUIDのlink成功はepochを保って `cancelled` とする。commit書込みが失敗してもpendingが残るため、他タブはfail-privateを維持する。タブ中断でpendingが残った場合は、利用者が破棄を確認した明示的な復旧操作だけがepochを進める。

BroadcastChannelは即時通知を補助し、storage eventとfocus/visibility時の永続状態再照合を正本にする。下書きは保存時epochを持ち、一致しない旧形式・旧epochをfail-privateに復元しない。OTP成功後のUID再確認で危険なセッションを消した非2xx応答も専用private headerで認証文脈変更を示し、開始タブと他タブの秘密状態を破棄する。

staging/productionではCloudflare Turnstileを匿名Authとメール復帰要求に表示する。site keyだけをClient Componentへ渡し、tokenはReact stateだけに保持してURL・storage・ログへ残さず、Auth要求ごとに破棄する。secretはSupabase Auth側とサーバー設定だけに置き、設定不足は503、token不足は422としてfail closedにする。development/testのローカルAuthではCAPTCHAを必須にしない。

## ADR-C-004: 本人の年別一覧も署名不要の厳格keysetに限定する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 04 §5・§8.2、07 段階C

`/me/worlds` は検証済みactorだけをDB文脈へ渡し、利用者入力のUIDを受け付けない。cursorは `(updatedAt, publicId)` の型・形式・canonical base64urlを厳格検証し、不正値を400にする。DB関数はlookaheadを含む上限51件とpartial indexを使い、offsetや全件読み込みを避ける。
