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

Next.js はローカルの `next build` でも `NODE_ENV=production` を使用するため、公開先の意味まで `NODE_ENV` だけで判定しない。`EMANOWA_ENVIRONMENT=development|test|staging|production` を追加し、空欄は development とする。本番公開では production を明示し、設定不足をエラーとして扱う。

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
