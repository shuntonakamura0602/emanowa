# 段階D — 地図・探索の設定と確認手順

この文書は、段階Dの疎な地図、公開一覧、ランダム訪問をローカルまたはSupabase projectで再現・確認する手順です。公開地図の確認だけで匿名Authを作らず、`unlisted` / `hidden` の識別子と `owner_only` 本文をログや計測へ出しません。

## ローカル自動検証

Docker Desktopを起動し、固定したNode.jsと依存関係を選びます。

```bash
nvm use
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm test:stage-d
```

`test:stage-d` はローカルhostとPostgresの既定port `54322` を確認してからfixtureを作ります。`EMANOWA_ENVIRONMENT=staging|production`、remote API、remote DBでは実行を拒否します。処理内容は次のとおりです。

- 全migrationを適用し、段階B/C/DのpgTAPとDB lintを実行する
- 段階Bの同時投稿・冪等性・RLSと、段階Cの本人更新・削除・メール復帰を回帰確認する
- 2027 worldへ公開1,000件、同一20×20チャンクへ400件、別チャンクへ `unlisted` / `hidden`、公開絵馬へ `owner_only` の固有文言を作る
- 空の2097 worldを作り、空overview、revision 0の空チャンク、対象なしのランダム訪問を確認する
- 20/100枠overview、最大400セルのchunk、24/50件の一覧、category、canonical cursor、UUID pivotによるランダム訪問を本番Next.jsサーバーへ要求する
- 公開JSON、HTML、RSCに秘密fixtureが含まれず、公開GETがSet-CookieやAuthユーザーを増やさないことを確認する
- 密集チャンク、20枠overview、50件一覧を各15回取得し、p50/p95と最大非圧縮JSON byteを `METRIC` 行へ出力する

試験後もローカルfixtureは残るため、通常の開発データへ戻す場合は `pnpm db:reset` を実行します。ローカルサービスを止めるときは `pnpm supabase:stop` を使います。

### 2026-10-28のローカル基準値

Node.js `24.17.0`、pnpm `11.25.0`、ローカルSupabaseとproduction Next.jsサーバーで、次の結果を確認しました。

- `pnpm check`: 成功。Vitest 24ファイル196件
- pgTAP: 段階B 50件（context 2件・private schema 48件）、段階C 58件、段階D 48件、合計156件
- production build: 成功
- 段階B/C HTTP回帰: 成功。同一枠100件同時要求は成功1件・`SLOT_TAKEN`99件
- 段階D HTTP統合: 成功。公開JSON・HTML・実RSC payloadに非公開fixtureなし、公開GETによるCookie・匿名Auth作成なし

各15回のproduction server実測:

| 対象                        | p50       | p95       | 最大非圧縮JSON |
| --------------------------- | --------- | --------- | -------------- |
| 密集チャンク400件           | 109.47 ms | 114.61 ms | 155,394 bytes  |
| 20枠overview・占有1,002件   | 7.73 ms   | 22.54 ms  | 345 bytes      |
| 公開1,000件中50件の新着一覧 | 13.91 ms  | 26.43 ms  | 18,236 bytes   |

この値はローカル基準であり、cloud RTT、CDN、端末のCanvas描画性能を保証しません。依存関係、DB件数、実行環境を変えた場合は同じコマンドで取り直します。

## 手動API確認

`pnpm db:local-role` が表示した限定 `DATABASE_URL` と、`pnpm exec supabase status --output env` のAPI URL / publishable keyを `.env.local` へ設定して `pnpm dev` を起動します。秘密値はshell履歴、スクリーンショット、コミットへ残しません。

```bash
pnpm db:local-role
pnpm dev
```

別のterminalから公開APIを確認します。

```bash
curl -i 'http://localhost:3000/api/v1/worlds/2027/overview?cellSize=100'
curl -i 'http://localhost:3000/api/v1/worlds/2027/overview?cellSize=20'
curl -i 'http://localhost:3000/api/v1/worlds/2027/chunks?cx=0&cy=0'
curl -i 'http://localhost:3000/api/v1/worlds/2027/emas?limit=24&category=health'
curl -i 'http://localhost:3000/api/v1/worlds/2027/emas/random?category=health'
```

確認点:

- overviewは `cellSize`、最大2,500件の集計セル、`asOf` だけを持ち、本文・名前・公開IDを持たない
- overviewの `Cache-Control` は共有最大30秒以下、world・chunk・一覧・random・個別は `no-store`
- chunkは指定した `cx` / `cy` とrevision、最大400セルだけを同じ呼出しSQL文のスナップショットで返し、4 MiB超過時は部分JSONではなく503になる
- `public` は固定のPublicEma、`unlisted` / `hidden` は座標と表示番号だけの `occupied` となる
- `owner_only` の `messageText` は縮尺に関係なく `null` で、ブラウザー側へ秘密本文を渡していない
- 一覧・randomはactive/publicだけで、cursorを別world・別categoryへ再利用すると400 `INVALID_CURSOR` になる
- Cookieを付けない公開GETにSet-Cookieがなく、閲覧だけで匿名Authユーザーが作られない

## ブラウザー確認

`http://localhost:3000/w/2027` を360px、390px、768px、1440pxで確認します。開発者ツールでネットワークを記録する場合も、願い本文やCookieを外部サービスへ送信しないでください。

1. 全体表示では100×100集計、拡大すると20×20集計、さらに拡大すると個別形状、1枠80px以上で公開本文が表示される。
2. マウスドラッグ、ホイール、タッチのパン・ピンチ、`+` / `-`、全体表示、中心復帰で同じカメラ契約を使う。
3. 6 CSS px以内の操作はタップ、それを超える移動はドラッグとなり、ドラッグ後に作成画面を開かない。
4. 空き枠、公開絵馬、使用中の非公開枠、未取得範囲が見分けられ、未取得や通信失敗を空きと表示しない。
5. 空き枠の「ここに掛ける」から作成画面へ進むと選択番号が入り、既存の本文・公開設定を失わない。確定前に予約済みとは表示しない。
6. 地図へfocusし、矢印で1枠、Shift+矢印で10枠、Enterで選択、Escapeで解除できる。入力欄では地図のkey操作が動かない。
7. 一覧だけで公開絵馬を読み、地図へ移動し、新規作成へ到達できる。24件ごとにページを置き換えて任意の深さまで進み、現在ページを30秒間隔でrefreshする。category変更時に前categoryの項目を残さない。
8. 番号1と1,000,000へ移動でき、範囲外・小数・文字列は画面内で拒否する。
9. 「自分の絵馬」は本人だけの位置へ移動し、本文原本を公開地図cacheへ入れない。未作成・認証切れにも定義済みの案内を出す。
10. タブを非表示にすると描画と取得を止め、復帰時は古いchunk・一覧・world統計を破棄して再取得する。休止中に非表示・削除・公開縮小した本文を再表示しない。
11. `prefers-reduced-motion: reduce` では移動のsmooth animationを使わない。Canvas外の選択状態と操作結果を読み上げられる。
12. 公開詳細の「地図で見る」は対象座標の `z=80` へ移動する。編集URLはqueryの期待public IDと本人APIのOwnerEmaが一致しない場合に原文を表示しない。

密集400件の領域を代表スマートフォンで10秒移動し、Performance panelでフレーム時間を記録します。継続30fps以上を目標とし、同一視点のチャンクは最大16、同時通信は最大4、確定前の待ちは約200ms、通常chunkは非圧縮512 KiB以下であることをNetwork panelでも確認します。自動試験のNode側応答時間はブラウザー描画fpsやcloud RTTの代用にしません。

## Supabase projectへの適用

段階B/Cの設定を完了したstaging projectへ、migration専用接続で適用します。

```bash
pnpm exec supabase login
pnpm exec supabase link
pnpm exec supabase db push
```

通常BFFには引き続きtransaction poolerの `emanowa_app` だけを設定します。`app_private` をData APIのexposed schemasへ追加せず、`anon`、`authenticated`、`service_role` へtable/function権限を与えません。migration適用後に次を確認します。

- `get_public_overview`、`get_public_chunk_meta`、`get_random_public_ema` は固定search pathのsecurity definerで、EXECUTEは `emanowa_app` だけ
- `emanowa_app` は `NOBYPASSRLS`・非所有者で、通常時は `NOLOGIN`、環境secret設定後だけpoolerから接続できる
- chunkの `(world_id, x/20, y/20, y, x)`、公開randomの `(world_id, public_id)`、category randomの `(world_id, category, public_id)` partial indexがある
- 代表データを入れた `EXPLAIN (ANALYZE, BUFFERS)` で、chunk・一覧・category有無のrandomが全件scanや巨大sortを常用しない
- CDNまたはreverse proxyが `no-store` 応答を保存せず、overviewも30秒を超えて保持しない
- stagingの公開GET前後でAuthユーザー数が不変で、owner-only / unlisted / hiddenの固有文字列がJSON、HTML、RSC、ログ、計測へ出ない

cloudではローカルのp50/p95を基準値にせず、stagingの同一region、通常のpooler接続、実CDN経路でRTT、LCP、chunk byte、DB query時間を記録します。異常時は4 MiB上限を広げず、先読み・同時取得・表示粗さを調整します。

## 段階Dで追加しない設定

段階Dは新しい外部サービスや秘密値を追加しません。既存のSupabase、限定DB role、Turnstile、正規originを使います。共有画像・X/LINE・近くへの招待は段階E、通報・管理者非表示・共有rate limitは段階Fで設定します。

参照: [Supabase Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Managing Indexes](https://supabase.com/docs/guides/database/postgres/indexes)
