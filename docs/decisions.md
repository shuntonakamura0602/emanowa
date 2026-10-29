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

## ADR-D-001: 公開地図は疎な集計と1チャンクのexecute-only境界にする

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 03 §4・§5・§11、04 §6・§8・§10、07 段階D

1000×1000枠を行やDOMとして全件取得せず、遠景は既存の20×20 `world_chunks` を20または100枠単位へ集約し、近景は20×20の1チャンクだけを返す。概要は最大2,500領域、チャンクは最大400セル、クライアントの1視点は最大16チャンク、同時要求は4本に固定する。上限を超える広い近景は、部分応答を空き枠と誤認させず集計表示へ戻す。

DB境界は段階Bと同じ `app_private` の固定search path・execute-only `SECURITY DEFINER` 関数とする。チャンクのrevisionとセルは同一SQL文の同一スナップショットで読み、`unlisted` と `hidden` は `{kind:'occupied',x,y,slotNumber}` 以外を返さない。`owner_only` の本文は公開投影でNULLのままにする。通常のチャンク・一覧・ランダム応答は `no-store`、本文・名前・IDを持たないoverviewだけ共有キャッシュを最大30秒許可する。

## ADR-D-002: Canvasの一時状態と公開データ取得をReactの画面状態から分離する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 02 §3・§9、03 §3・§4・§11、04 §10、07 OPS-09

高頻度なカメラ・pointer・描画状態はrefと `requestAnimationFrame` に置き、確定時だけReact state、sessionStorage、`history.replaceState`へ反映する。devicePixelRatioは最大2、タップとドラッグは6 CSS pxで分け、縮尺に応じて100枠集計、20枠集計、個別形状、公開本文へ切り替える。Canvasを使えない場合にも、HTMLの一覧・番号入力・作成入口・自分の絵馬への移動を残す。

公開GETは `credentials:'omit'` とし、200msの確定待ち、AbortController、要求世代で古い範囲の遅着を破棄する。チャンクと一覧の保持量には上限を設け、タブ非表示中は描画・取得を止め、復帰時は本文を含み得る公開キャッシュを破棄して再取得する。本人位置だけは段階CのWeb Lockと認証epochを再利用し、OwnerEmaを公開地図キャッシュへ混ぜない。

## ADR-D-003: 公開探索は精度を保つkeysetと索引付きUUID pivotに限定する

- 状態: 採用
- 日付: 2026-10-28
- 関連仕様: 03 §7、04 §8.2・§10、07 ACCESS-05・OPS-09

新着一覧は `(created_at DESC, public_id DESC)` のkeysetとし、cursorにversion、world、category、order、DB精度の作成日時、public IDをcanonical base64urlで保持する。署名は用いないが、未知キー、形式、再符号化、world/category不一致を厳格検証し、最大50件とlookaheadだけを取得する。クライアントはpublic IDで重複除去しつつ、保持件数を制限する。

ランダム訪問は全件 `ORDER BY random()` や巨大OFFSETを使わない。ランダムなUUID pivot以降の先頭1件を索引で探し、なければ先頭へ1回だけ折り返す。category有無のSQL経路を分け、`visibility='public'` のworld索引・category索引に一致させる。対象なしは200の `{item:null}` とし、`unlisted` と `hidden` は候補にしない。

## ADR-E-001: 共有ページと画像は公開投影だけを入力にし、保存しない

- 状態: 採用
- 日付: 2026-10-29
- 関連仕様: 05 §2・§3・§8・§9、07 段階E

個別ページ、metadata、OG画像、正方形PNGは同じ `PublicEma` 投影だけを入力にする。`owner_only` の原文は投影時点で `null` のため、HTML、RSC、metadata、画像rendererへ渡らない。画像APIは毎回 `no-store` とし、描画前後で公開versionを再取得する。描画中に公開縮小・非表示・削除が起きた場合は古いbytesを返さず、1回だけ新しい投影で再描画し、さらに変化した場合は一時エラーとする。

画像はruntimeの外部font・emoji CDNへ依存させない。固定commitから取得したNoto Sans JPのOFL版をローカルassetとして同梱し、source・license・SHA-256を記録する。外部emoji fontを取得できない場合に文字が消えたり生成全体が失敗したりしないよう、絵文字graphemeは共有画像だけで明示的な `◇` と説明へ置き換える。元の公開本文、個別ページ、共有文章は変更しない。

XとLINEの入口は本人が確認できる共有dialogから外部の投稿・送信画面を開くだけとし、クリックを投稿完了として扱わない。通常URL・招待URL・画像URLは設定済みoriginと固定pathから再構築し、現在URLのquery、fragment、userinfo、Cookie、tokenを引き継がない。画像失敗時もURLコピーと外部共有を独立して利用できる。

## ADR-E-002: 近隣候補は限定DB関数で探すが予約せず、利用者が選ぶ

- 状態: 採用
- 日付: 2026-10-29
- 関連仕様: 03 §6、04 §6・§8、05 §4、07 段階E

招待元または座標の周囲をChebyshev半径3、8、20の順で広げ、最大41×41だけを調べる。最大8候補を距離二乗、表示番号の順に返し、100万枠の空行や全枠scanを作らない。関数は `app_private`、固定search path、`SECURITY DEFINER`、`NOBYPASSRLS` 所有者とし、通常BFF roleだけが実行できる。unlistedはtransaction-localの正確なlookup UUIDがある直接招待だけを解決し、hidden、deleted、別worldは対象にしない。

候補応答は空きの観測であり、予約や所有権を付与しない。画面は候補を自動選択せず、本人が番号を選ぶ。確定時は既存の原子的作成処理で同一枠・同一所有者を再検証し、`SLOT_TAKEN` なら下書きを保持して候補を取り直す。招待URLの `near` は公開設定、所有者、作成payloadへ入れない。既に同年の絵馬があるセッションでは二枚目のフォームを出さず、既存の絵馬へ案内する。

## ADR-E-003: 共有計測は内容を持たないprovider-neutralなブラウザーeventにする

- 状態: 採用
- 日付: 2026-10-29
- 関連仕様: 01 §6、05 §8、07 ACCESS-12

P0の `ema_created`、`share_opened`、`share_clicked`、`link_copied`、`share_image_downloaded`、`invite_landed`、`invite_ema_created` は、`emanowa:measurement` というブラウザー `CustomEvent` で通知できるようにする。型付きpayloadは年、共有先、通常/招待の区別だけを許し、願い本文、表示名、メール、公開ID、URL、token、Cookieを受け取らない。

外部analytics providerや永続collectorはリポジトリへ仮設定しない。接続する場合はこのeventのlistener側で行い、失敗や未接続でも共有、コピー、画像保存、投稿を止めない。`share_clicked` は共有先を選んだ事実であり、X投稿完了やLINE送信完了として数えない。
