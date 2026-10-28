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
