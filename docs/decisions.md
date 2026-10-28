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
