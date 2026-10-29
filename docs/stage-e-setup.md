# 段階E — 共有と近くへの招待の設定・確認手順

この文書は、個別URL、OG/正方形PNG、X/LINE共有、URLコピー、近隣候補、別ブラウザーからの招待投稿をローカルまたはstagingで確認する手順です。共有経路は公開投影だけを読み、閲覧だけで匿名Authを作りません。

## ローカル自動検証

Docker Desktopを起動し、固定したNode.jsと依存関係を選びます。

```bash
nvm use
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm test:stage-e
```

`test:stage-e` はローカルhostとPostgresの既定port `54322` を確認してからfixtureを作ります。`EMANOWA_ENVIRONMENT=staging|production`、remote API、remote DBでは実行を拒否します。処理内容は次のとおりです。

- 全migrationを適用し、段階B〜EのpgTAPとDB lintを実行する
- 段階B〜Dの同時投稿、本人管理、メール復帰、公開地図を回帰確認する
- public、unlisted、owner-only、hidden、deleted、別world、80書記素・改行・絵文字を含む画像用fixtureを作る
- `near` と `x/y` の排他、半径3/8/20、最大8件、距離二乗・表示番号順、空候補、年度境界を確認する
- 個別JSON、HTML、RSC、metadata、OG/正方形PNGに非公開本文がなく、公開GETにSet-CookieやAuthユーザー作成がないことを確認する
- PNG signatureと1200×630 / 1080×1080のIHDR、unlisted画像の検索抑止、招待landingの`noindex`を確認する
- 公開本文を`owner_only`へ縮小した後と削除後に、同じ画像URLが古い内容を返さないことを確認する
- 独立Cookieの招待先ブラウザーで、landing、明示的な匿名Auth、候補選択、投稿、同じworld内の2点を確認する
- 同じ候補への同時投稿が成功1件・`SLOT_TAKEN`1件、既存本人の二枚目が`OWNER_LIMIT_REACHED`になることを確認する

試験後もローカルfixtureは残ります。通常の開発データへ戻す場合は `pnpm db:reset`、サービスを止める場合は `pnpm supabase:stop` を実行します。

### 2026-10-29のローカル結果

Node.js `24.17.0`、pnpm `11.25.0`、ローカルSupabaseとproduction Next.jsサーバーで確認しました。

- `pnpm check`: 成功。Prettier、ESLint、TypeScript、Vitest 32ファイル223件
- pgTAP: 段階B 50件、段階C 58件、段階D 48件、段階E 30件、合計186件
- `pnpm test:stage-e`: 成功。段階B〜EのDB/Auth/HTTP回帰とproduction buildをクリーンDBから完走
- 異なるUIDの同一枠100件: 成功1件、`SLOT_TAKEN`99件
- 段階Eの同一候補2件: 成功1件、`SLOT_TAKEN`1件
- 別Cookieの招待landing: Cookie/Auth作成なし。明示匿名Auth後の投稿、年1枚制約、同一worldの2点確認に成功
- 画像: OG 1200×630、square 1080×1080。80書記素・改行・絵文字markerを実endpointで生成し、原寸目視でもclipなし
- renderer単体の初回ローカル値: OG 577ms、square 288ms。cloudや負荷時の性能保証ではない

段階Dの回帰実測は密集400件chunkがp50 `108.74 ms`・p95 `146.54 ms`・最大`155,394 bytes`、20枠overviewがp50 `7.17 ms`・p95 `9.58 ms`・最大`345 bytes`、50件一覧がp50 `13.58 ms`・p95 `23.24 ms`・最大`18,236 bytes`でした。段階Eの変更後も既存上限を満たすことを確認するための回帰値であり、実端末描画やcloud RTTの代用にはしません。

## 共有URLと画像

公開詳細は `/w/{worldSlug}/e/{publicId}`、招待は `/w/{worldSlug}/new?near={publicId}` です。現在ページのquery、fragment、userinfo、Cookie、認証tokenを共有URLへ引き継がず、設定済み `APP_ORIGIN` と固定pathだけから組み立てます。`APP_ORIGIN` は `https://example.com` のようなbare originだけを許可し、userinfo、path、query、fragmentを含む値を設定エラーにします。

画像API:

```text
GET /api/v1/worlds/{worldSlug}/emas/{publicId}/image?variant=og
GET /api/v1/worlds/{worldSlug}/emas/{publicId}/image?variant=square
```

- `og`: 1200×630 PNG
- `square`: 1080×1080 PNG
- public/unlistedの直接URLだけを描画し、hidden/deleted/別worldは404
- `owner_only` は固定の「願いはひみつです」だけを描画
- 成功・失敗とも公開応答は`no-store`。unlisted画像は`X-Robots-Tag: noindex, noimageindex, noarchive`
- 描画前後の公開versionを照合し、途中で公開縮小・削除された古いbytesを返さない
- 画像失敗はURLコピーやX/LINE共有を失敗させない

共有画像は実行時に外部font/emoji CDNへ接続しません。`assets/fonts/NotoSansJP-Regular.otf` は `notofonts/noto-cjk` のcommit `523d033d6cb47f4a80c58a35753646f5c3608a78`、`Sans/SubsetOTF/JP/NotoSansJP-Regular.otf` を固定した静的CFF版です。SHA-256は `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073`、licenseは同directoryの`OFL.txt`です。

外部emoji fontへ依存すると画像生成全体が失敗し得るため、共有画像内だけはemoji graphemeを `◇` と凡例へ決定的に置き換えます。個別ページ、公開本文、共有文章の文字列は変更しません。80書記素は切り捨てず、OGは最大20字×4行、正方形は最大16字×5行へ収めます。任意の目視用PNGは次で一時directoryへ生成できます。

```bash
mkdir -p /tmp/emanowa-stage-e-preview
EMANOWA_IMAGE_PREVIEW_DIR=/tmp/emanowa-stage-e-preview \
  pnpm exec vitest run src/server/share/ema-image.test.ts
```

## 共有画面の確認

詳細画面で「この絵馬を共有する」を開きます。公開カード、共有文章、公開URLを確認してから、X、LINE、コピー、画像保存を選びます。

- X/LINEは外部の投稿・送信画面を開くだけで、アプリから確定や自動投稿をしない
- クリック後の案内も「投稿/送信画面を開いた」と表示し、完了とは表示しない
- Clipboard APIが拒否された場合は、選択可能なURL入力欄を出す
- PNG取得失敗時もdialogを閉じず、リンク共有を利用できる
- unlisted詳細と画像、`near`付き作成画面は検索抑止を付ける
- 詳細と招待元は30秒間隔とタブ復帰時に公開状態を再取得する。削除・非表示・本文の公開縮小後は旧本文を保持しない

共有先形式は[X Web Intent](https://developer.x.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent)と[LINE Social Plugins](https://developers.line.biz/en/docs/line-social-plugins/install-guide/using-line-share-buttons/)の公式仕様を確認して更新します。SNS側の実送信、crawlerのOG取得、アプリ内WebViewはstagingの正規URLで別途確認します。

## 近くへの招待

`GET /api/v1/worlds/{worldSlug}/nearby` は次のどちらか一方だけを受け付けます。

```text
?near={publicId}
?x={0..999}&y={0..999}
```

`near` と `x/y` の混在、片方だけの座標、重複query、不明なkeyは400です。招待元はpublicまたは正確なunlisted UUIDだけを解決し、hidden、deleted、別worldは404です。候補は半径3、8、20を上限に最大8件、距離二乗・表示番号順で返します。候補は予約ではなく、自動選択もしません。利用者が選び、保存transactionで空きと年1枚制約を再確認します。

招待landingのGETはCookieを作りません。入力開始または確定時の明示操作でだけ匿名Authを作ります。既に同年の絵馬がある有効sessionでは本人APIの最小状態だけを読み、二枚目のフォームを止めます。招待元が消えた場合も通常の番号入力へ戻れますが、古い招待本文と候補は隠します。

## 計測event

P0の計測点はブラウザーの `emanowa:measurement` `CustomEvent` で通知します。外部collectorは未設定です。接続時は次のevent detailだけを受け取り、追加fieldを外部へ送らないでください。

```text
ema_created
share_opened
share_clicked                 channel=x|line, linkKind=public|invite
link_copied                   linkKind=public|invite
share_image_downloaded
invite_landed
invite_ema_created
```

共通fieldは4桁の`worldSlug`だけです。中央dispatcherがpayloadを再構築するため、願い本文、表示名、メール、公開ID、URL、token、Cookieは型外のfieldとして渡されてもevent detailから除外されます。listenerやanalytics SDKの失敗は主操作を止めません。`share_clicked` は投稿・送信完了ではありません。

## Supabase project / stagingへの適用

段階B〜Dの設定済みstagingへmigration専用接続で適用します。

```bash
pnpm exec supabase login
pnpm exec supabase link
pnpm exec supabase db push
```

通常BFFには引き続きtransaction poolerの `emanowa_app` だけを設定します。`app_private` をData APIへ公開せず、`anon`、`authenticated`、`service_role`へtable/function権限を与えません。`get_nearby_slots` は固定search pathの`SECURITY DEFINER`で、EXECUTEは`emanowa_app`だけです。`create_ema`がworld行へ`FOR SHARE`を取れるよう `worlds_owner_update_lock` policyを追加していますが、通常BFF roleにworld更新権限はなく、所有者roleも通常`NOLOGIN`です。

stagingでは次を確認します。

1. 正規 `APP_ORIGIN` でcanonical、OG URL、通常/招待URLが同じoriginになる。
2. CDN/reverse proxyが詳細、nearby、画像の`no-store`を保存せず、unlisted/nearの検索抑止を保持する。
3. X/LINEの実画面、主要crawler、iOS/Androidの保存・Clipboard fallbackで内容を本人が確認できる。
4. public→owner-only/hidden/deleted後に、同じURLのHTML、RSC、metadata、画像が旧本文を返さない。
5. cloud Supabaseのtransaction poolerでも候補競合と年1枚制約が同じ結果になる。

## 未完了・外部確認

- cloud Supabase、stagingドメイン、CDN、実X/LINEアプリ、SNS crawlerは未接続
- 360/390/768/1440pxの視覚、dialog focus、Clipboard拒否、iOS/Android画像保存、キーボード、スクリーンリーダーは代表端末での確認が必要
- 本番analytics collectorは未設定。接続後にイベント名を投稿完了へ読み替えず、秘密fieldが送信・ログ・error収集へ入らないことを再監査する
- 共有レート制限、通報、運営による非表示・復帰、監査記録は段階Fの対象

参照: [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Supabase database functions](https://supabase.com/docs/guides/database/functions)、[Next.js ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response)
