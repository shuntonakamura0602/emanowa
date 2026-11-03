# 段階G — 性能・アクセシビリティ・回復の確認手順

この文書は、P0段階Gの実ブラウザー検証、性能計測、障害注入、ローカルbackup/restore訓練を再現する手順です。計測値はローカルproduction buildで得た値であり、公開環境の性能保証ではありません。

## 前提

- Node.js 24.17.0とpnpm 11.25.0をリポジトリの指定どおりに選ぶ
- Docker Desktopを起動し、ローカルSupabaseを利用できる
- Google Chromeを利用できる。macOSの標準配置以外では `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に実行ファイルを指定する
- `psql` を利用できる。復旧訓練は対話設定やambient `PG*` に依存せず、検証済みローカル接続値を明示して実行する

依存関係はlockfileへ固定しており、ブラウザー検証には `@playwright/test 1.64.1` と `@axe-core/playwright 4.14.0` を使用します。Playwrightが独自に取得したブラウザーだけに依存せず、既定では `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` を使用します。

## ローカル自動検証

```bash
nvm use
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm test:stage-g
pnpm supabase:stop
```

Chromeが標準位置にない場合は、実際の実行ファイルを現在のshellだけへ指定します。

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/path/to/Google Chrome' pnpm test:stage-g
```

注意: `test:stage-g` はローカルSupabase DBをresetし、復旧訓練では `app_private` schemaを削除して論理backupから戻します。必要なローカルデータは先に退避してください。各scriptはAPI host、DB host、Postgres port `54322`、`EMANOWA_ENVIRONMENT` を検査し、remote DBまたはstaging/productionでは実行を拒否します。

`test:stage-g` は次を順に行います。

1. 段階B〜FのクリーンDB、pgTAP、DB lint、Auth・API・所有権・公開範囲・同時実行回帰
2. 段階Dの地図・探索性能回帰
3. `scripts/stage-g-browser.mjs` によるproduction buildの実ブラウザー検証
4. `scripts/stage-g-recovery.mjs` によるローカル論理backup/restoreと再非公開化訓練

個別に原因を切り分ける場合は、先に段階Fのfixtureを作成してから実行します。

```bash
pnpm test:stage-f
node scripts/stage-d-integration.mjs
node scripts/stage-g-browser.mjs
node scripts/stage-g-recovery.mjs
```

途中で復旧訓練が失敗した場合は、部分的に復元されたローカルDBを開発へ流用せず、原因を保存してから `pnpm db:reset` でmigrationから再作成してください。

## 実ブラウザーで確認する内容

ブラウザー試験は、秘密値を生成したテスト用環境でNext.jsのproduction buildを起動し、試験後に一時的なDB role passwordとserverを片付けます。

- 360px、390px、768px、1440pxで横overflowがなく、主要操作が44×44 CSS px以上である
- 地図、作成、個別詳細、本人管理、招待経路をaxeでWCAG 2.2 AAとして検査し、違反がない
- Canvasをキーボードで移動・選択でき、`prefers-reduced-motion` がscroll・transition・animationへ反映される
- 共有・通報dialogをEscapeで閉じた後、focusが元の操作へ戻る
- 画像生成が503でもURLコピーとX・LINEの共有入口を利用できる案内を表示する
- DB保存後に作成応答だけが切断された場合、同じ内容とIdempotency-Keyで元のreceiptを復元する
- 別タブでログアウトした後、古いCookieで遅着した本人応答を画面へ反映しない
- OTP送信中は多重送信を止め、無効・期限切れ時も認証コード欄、期限、再送案内を保持する
- DB接続不能時は `no-store` の503と安全な公開エラーを返し、資格情報や内部例外を表示せず再試行操作を示す
- 画像rendererの失敗は `no-store` の503になり、描画後にhidden/deletedへ変わった作品は古い画像を返さず404になる

自動axe検査は手動スクリーンリーダー検証の代わりではありません。VoiceOver、TalkBack等で「書く・プレビュー・投稿・共有・本人管理」へ到達できることは、段階Hのstaging確認で別に実施します。

## 性能の計測条件と結果

2026-11-03に、Node.js 24.17.0、Next.js 16.4.3、ローカルSupabase/Postgres、macOS上のGoogle Chrome headlessを使って測定しました。

| 対象           | 条件                                                       |                     ローカル結果 |                   初期目標 |
| -------------- | ---------------------------------------------------------- | -------------------------------: | -------------------------: |
| 密集chunk      | 公開400件、非圧縮JSON、15回                                | p95 103.71 ms、最大155,394 bytes | 512 KiB未満、保護上限4 MiB |
| 投稿確定API    | 独立した匿名20利用者が同時作成                             |         20/20成功、p95 279.35 ms |       stagingでp95 2秒未満 |
| 公開地図LCP    | 390×844、150 ms latency、1.6 Mbps down、750 kbps up、CPU×4 |                           744 ms |                  2.5秒以下 |
| 初期転送量     | 上と同じnavigation/resourceのtransfer size合計             |                    242,295 bytes |         結果を記録して調整 |
| 密集地図の移動 | 390×844、10秒間pointer移動                                 |                        60.06 fps |             継続30 fps以上 |

同じマシンの単発ローカル値であり、公開環境のサーバー地域、CDN、実端末、バックグラウンド負荷を含みません。公開後は代表ページと端末・回線条件を固定し、十分な実利用データが得られた時点でLCP p75を確認します。cloudの20同時作成は本番データへ負荷fixtureを入れず、許可されたstagingで行います。

## backup/restoreと再非公開化の訓練

`scripts/stage-g-recovery.mjs` はローカルDBだけを対象に、次の事故を再現します。

1. 公開中の2作品を選び、`app_private` のschemaとdataを `supabase db dump` で一時ディレクトリへ保存する
2. backup取得後に一方をhide、もう一方をdeleteし、公開投影が消えたことを確認する
3. `app_private` を削除し、古いbackupだけを `psql` で戻す
4. backup時点の公開投影が復活し、後発のhide/deleteが巻き戻ることを確認する
5. backupとは別に作ったprivacy replay台帳を検証し、同じ管理用moderation関数でhide/deleteを再適用する
6. hiddenは占有を保持して公開投影を持たず、deletedは本文・表示名・占有・公開投影を持たないことと、監査記録を確認する
7. 個別API、HTML、OG、正方形PNG、新着一覧、対象座標のchunkから内容と公開IDが出ないことを確認する

試験用privacy replay台帳には、`publicId`、`hide|delete`、`expectedVersion`、`idempotencyKey`、列挙済み理由だけを入れます。願い本文、表示名、メール、通報補足、Auth token、DB内部IDは入れません。試験終了時は一時ディレクトリだけを削除します。

このscriptはローカル `app_private` の論理dumpだけを検証します。Supabase project全体、`auth` schema、Storage object、provider snapshot、PITR、別リージョンからの復旧を検証するものではありません。また、Supabaseの管理backupはカスタムDB roleのpasswordを保存しないため、復元後は `emanowa_app` と `emanowa_admin_app` の異なるpasswordを安全な管理接続から再設定し、owner/provisionerを `NOLOGIN` のまま維持する必要があります。

## 公開環境で確定する復旧手順

段階Hでは、少なくとも次を環境固有のrunbookへ確定します。

1. 新規投稿と公開配信を安全に止め、復旧作業中のDBへ通常/adminアプリを接続しない
2. backupの種類、頻度、暗号化、保持期間、保存地域、PITR範囲、restore担当と承認者を記録する
3. hide/deleteと公開範囲縮小のappend-only台帳をbackupとは別の耐久領域へ保存する。本文等の内容は保存しない
4. DBとrole資格情報を復元し、通常/admin/owner/provisionerの権限分離を再検証する
5. backup取得後のhide/deleteを、version・冪等性・監査を持つ同じ運用関数で再適用する
6. API、HTML、RSC、metadata、OG/PNG、一覧、random、nearby、chunk、CDNで非公開内容が出ないことを確認する
7. 監視、Auth、SMTP、rate limit、管理者AAL2を確認し、二名確認等の運用承認後に配信を再開する

古いbackupを戻しただけで公開を再開しません。削除・非公開化の再適用と全公開経路の確認が終わるまで、再公開の安全性は確認済みと扱いません。

## 未完了・外部確認

- cloud Supabaseのbackup/PITR、実restore時間、別リージョン、Auth/Storageを含む完全復旧は未確認
- privacy replay台帳の本番保存先、暗号化、保持期間、改ざん防止、アクセス権、当番と承認手順は未確定
- stagingのCDN/reverse proxy、Turnstile、SMTP、本番MFA、実SupavisorとproviderのSSL enforcementは未接続
- 実端末のタッチ・ピンチ、VoiceOver/TalkBack等の手動支援技術、OS別のvisual regressionは未確認
- 実X/LINEアプリ、SNS crawler、実端末のClipboard/画像保存は未確認
- 公開環境のLCP p75、cloudの20同時作成、監視・通知・費用上限は段階Hで確認する

参照: [Supabase Backups](https://supabase.com/docs/guides/platform/backups)、[Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
