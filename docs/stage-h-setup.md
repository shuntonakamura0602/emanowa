# 段階H — 公開環境の設定・移行・運用手順

この文書は、P0をstagingからproductionへ移す際のprovider-neutralなrunbookです。実際のドメイン、運営者、問い合わせ先、world受付期間、保存期間、当番、復旧目標はまだリポジトリから確定できません。空欄や仕様書の提案値を本番値として扱わず、[公開チェックリスト](launch-checklist.md)へ承認済みの値と証跡を記録してください。

`/api/health/ready` の成功と、worldが現在投稿可能であることは別です。readinessは、リポジトリ側の公開設定が揃い、設定したfeatured worldをDBから読めることを表します。SMTP、Turnstile、backup、監視providerまで動作確認するendpointではありません。`GET /api/v1/worlds/{slug}` の `world.acceptingPosts` はDB時刻、world状態、受付期間、`posting_enabled`から求めた現在の受付可否を表します。受付前・受付終了・緊急停止中でも、安全に閲覧できるdeploymentはreadyになり得ます。

## 1. 公開前に人が確定する値

次の値に既定値はありません。productionで使う値を、承認者、承認日、根拠とともにチェックリストへ記録します。

| 項目                        | 確定する内容                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| production / staging origin | それぞれのHTTPS bare origin。path、query、fragment、userinfoを含めない                           |
| deployment                  | host側project、region、release commit、productionへの昇格・rollback権限                          |
| Supabase                    | 環境ごとの別project ref、region、plan、Postgres version、Auth設定                                |
| world                       | 4桁slug、表示名、`preview/open/archived`、UTCの開始・終了、JST表示、`posting_enabled`            |
| 公開主体                    | 実際の `OPERATOR_NAME` とHTTPSの `CONTACT_URL`、問い合わせ担当                                   |
| 公開文書                    | `POLICY_EFFECTIVE_DATE` と、規約・プライバシー文面の承認者                                       |
| 保存方針                    | `CONTENT_RETENTION_NOTICE`、`BACKUP_RETENTION_NOTICE`、`LOG_RETENTION_NOTICE` と実システムの設定 |
| 運用                        | 通報当番、応答目標、違法・緊急内容のエスカレーション、休止判断者                                 |
| 復旧                        | backup方式、PITR範囲、privacy replay台帳、RPO/RTO、restore担当・承認者                           |
| 監視・費用                  | 監視provider、通知先、閾値、当番、利用量通知、予算上限                                           |

`2027`の日程や仕様書にある価格は設計上の提案であり、公開承認ではありません。保存期間も「永久」「無期限」と推測せず、作品、削除後の最小tombstone、backup、アクセスログ、監査、通報、privacy replay台帳を区別して決定します。

公開説明は、次を実際の挙動と一致させます。

- えまのわは独立したオンライン参加型サービスであり、神社・宗教団体との提携、祈祷、奉納、宗教上の効力を事実なく表示しない。
- `unlisted` は正確なURLを知る人が閲覧できる「URL限定」であり、認証付きの私的保管庫ではない。
- `owner_only` は本文だけを本人APIに限定し、入力した表示名の公開範囲とは別である。
- 削除・非公開化は自サービスの新しい応答へ反映するが、SNS等が過去に保存した複製を回収できるとは約束しない。
- backupから復旧する際は後発の削除・非公開化を再適用する。削除直後に全backupから消えるとは説明しない。

## 2. staging / productionの分離

最低でも次を環境ごとに分離します。

- hostのproject、custom domain、deploy権限、runtime secret、監視先、analytics dataset
- Supabase project、publishable key、通常DB role、管理DB role、migration/DBA資格情報
- Auth Site URL、redirect allow-list、custom SMTP資格情報と送信者、Turnstile widget/secret
- `RATE_LIMIT_HMAC_SECRET`、`TRUSTED_PROXY_HOPS`、管理者UUID/TOTP factor
- backup/PITR、privacy replay台帳、alert通知先、費用通知

production dataをstagingへ複製しません。復旧訓練等で避けられない場合は別途承認し、本文、メール、token等を匿名化した使い捨て環境で行い、終了時の消去を証跡化します。stagingのcookie、メール、CAPTCHA、管理者、テスト投稿がproductionで有効にならないことも確認します。

### 2.1 runtime設定

値の形式と必須条件の正本は `.env.example` とサーバー設定検証です。productionは少なくとも次を明示します。

| 分類         | production                                                                                      | staging                                     |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 環境         | `EMANOWA_ENVIRONMENT=production`                                                                | `EMANOWA_ENVIRONMENT=staging`               |
| data         | `EMANOWA_DATA_MODE=database`                                                                    | `EMANOWA_DATA_MODE=database`                |
| origin       | `APP_ORIGIN` に承認済みHTTPS bare origin                                                        | 別のHTTPS bare origin                       |
| 公開承認     | `PUBLICATION_APPROVED=true`。最終go/no-go前はtrueにしない                                       | production承認の代用にせずfalseまたは未設定 |
| 公開文面     | 承認済みの `OPERATOR_NAME`、HTTPS `CONTACT_URL`、`POLICY_EFFECTIVE_DATE`、3種のretention notice | stagingと明示した検証値。本番の仮値にしない |
| Auth         | 環境専用URL / publishable key                                                                   | 別projectの値                               |
| DB           | `emanowa_app` と `emanowa_admin_app` の別secret・別pool                                         | staging専用の別secret                       |
| world        | 承認済み `FEATURED_WORLD_SLUG`                                                                  | 試験対象slugを明示                          |
| 不正利用対策 | 環境専用Turnstile、32byte以上のHMAC secret、実proxy hop数                                       | staging専用の値                             |
| P0 gate      | groups / fulfillment / paymentsはfalse                                                          | 同じくfalse                                 |

`NEXT_PUBLIC_` が付くのはSupabase URL、publishable key、Turnstile site keyだけです。DB URL、CAPTCHA secret、HMAC secret、SMTP、migration/DBA資格情報をbrowser bundleへ入れません。`MIGRATION_DATABASE_URL`はdeploy環境へ常駐させず、承認済みmigration・管理者台帳・緊急操作の実行時だけsecret managerから注入します。

## 3. database migration

リポジトリ固定のSupabase CLIを `pnpm exec` で使います。以下のflagは2.122.0の `--help` で確認済みです。CLI更新時は再度 `supabase <command> --help` と[Supabase Changelog](https://supabase.com/changelog?types=breaking-change)を確認します。

### 3.1 適用前

1. localのclean DBで `pnpm test:stage-h` を完走し、migration順、pgTAP、lint、権限、復旧訓練、受付停止の実接続競合を確認する。
2. release commitを固定し、staging/productionで同じmigration集合を使用する。手編集したDashboard schemaを正本にしない。
3. 対象project ref、環境、region、DB version、現在のmigration一覧を二名で照合する。
4. productionでは利用可能なbackup/restore pointとprivacy replay台帳の書込みを確認し、変更時間、担当、rollback判断者を記録する。
5. [Postgres 15.19 / 17.11の破壊的変更](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)等、対象versionに該当する検出queryと対応を公式手順で確認する。

### 3.2 stagingを先に適用

CLI access tokenとDB passwordは承認済みsecret managerまたは対話入力から与え、コマンド引数、shell history、CI logへ書きません。次のplaceholderは実project refへ置換します。

```bash
SUPABASE_TELEMETRY_DISABLED=1 pnpm exec supabase link --project-ref '<staging project ref>'
SUPABASE_TELEMETRY_DISABLED=1 pnpm exec supabase migration list --linked
SUPABASE_TELEMETRY_DISABLED=1 pnpm exec supabase db push --linked --dry-run --skip-vault
```

dry-runの対象がrelease内の未適用migrationだけであることをreviewします。`--include-seed`は使いません。履歴修復を伴う `--include-all` は通常リリースで使わず、driftの原因と承認済み修復手順がある場合だけ別作業にします。確認後に適用します。

```bash
SUPABASE_TELEMETRY_DISABLED=1 pnpm exec supabase db push --linked --skip-vault
SUPABASE_TELEMETRY_DISABLED=1 pnpm exec supabase migration list --linked
```

`supabase db reset`、ローカル統合script、fixture投入scriptをremoteへ実行しません。適用後はSupabase Security/Performance Advisors、DB role・関数権限、通常/admin接続の分離を確認します。migrationはcustom login roleのpasswordを保存しないため、`docs/stage-f-setup.md`の対話手順で `emanowa_app` / `emanowa_admin_app` に異なるpasswordを設定し、owner/provisionerを `NOLOGIN` のままにします。

### 3.3 production

staging E2Eとcleanup、復旧可否、go/no-goが承認された同じreleaseだけをproductionへ適用します。project linkがstagingのままでないことを、project refとmigration一覧の双方で再確認してから、3.2と同じdry-run → review → push → migration listの順で行います。

DB migrationのrollbackを自動down migrationや`db reset`で行いません。schema変更は後方互換を保ち、問題時は新しいforward-fix migrationを優先します。データ破損・privacy事故でrestoreが必要な場合は第8節の復旧手順へ移ります。

[Supabaseのdatabase migration](https://supabase.com/docs/guides/local-development/database-migrations)と[環境管理](https://supabase.com/docs/guides/deployment/managing-environments)も公開判断時に再確認してください。

## 4. Supabase Auth / SMTP / CAPTCHA / 管理者

### 4.1 Auth URL

- DashboardのSite URLを各環境の `APP_ORIGIN` と完全一致させる。productionにlocalhostやpreview URLを設定しない。
- current P0はメール内の6桁OTPをアプリへ入力する。将来redirectを使う場合も、productionのRedirect URLsには実際に使うHTTPSのorigin/pathだけを列挙し、globstarを使わない。
- preview deploymentのwildcardをproduction projectへ入れない。必要ならstaging/preview専用Supabase projectへ限定する。
- Anonymous Sign-Insとmanual linkingを有効にし、閲覧GETだけでは匿名userが作られないことを確認する。

設定根拠: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)、[Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)。

### 4.2 custom SMTP

Supabaseのdefault SMTPはproduction用途ではなく、送信先やrate limitにも制約があります。production公開前にcustom SMTPを設定します。

- stagingとproductionで資格情報・senderを分け、送信domainの所有、SPF/DKIM/DMARC、bounce/complaint監視を確認する。
- Supabase Authの送信者、SMTP host/port/user/passwordをsecretとして登録し、email trackingによるOTP/link変形を無効にする。
- `supabase/templates/` とDashboardのtemplateを照合し、メール連携と復帰の6桁codeが実メールで届くこと、再送間隔、期限切れ、既存メール競合、未登録宛先のaccount enumeration防止をstagingで確認する。
- providerのquota、急増時の上限、障害通知、credential rotation担当を記録する。本文・メール・OTPをアプリlogやanalyticsへ送らない。

設定根拠: [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)。

### 4.3 Turnstile

- 環境ごとにCloudflare Turnstile widgetを作り、実hostだけをallow-listへ入れる。test keyをproductionへ使わない。
- site keyだけを `NEXT_PUBLIC_CAPTCHA_SITE_KEY`、secretをserverの `CAPTCHA_SECRET_KEY` とSupabase AuthのCAPTCHA設定へ登録する。
- 匿名Auth、メール復帰、失効token、再利用token、provider障害、設定欠落がfail closedになることをstagingの実widgetで確認する。
- token、secret、client IPをURL、Web Storage、analytics、通常logへ保存しない。

設定根拠: [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)。

### 4.4 管理者とMFA

- 共有アカウントを使わず、確認済みメールを持つ個人Auth user UUIDだけを管理者台帳へ登録する。メール文字列や`user_metadata`を権限根拠にしない。
- `docs/stage-f-setup.md`の `admin:access` で有効化し、fresh user、AAL2、`admin_users.enabled`、管理専用DB接続の四つを確認する。
- 各管理者がTOTPを本人の認証アプリへ登録し、AAL1、台帳外AAL2、無効化済み管理者を拒否する。
- factor紛失時の本人確認、factor再登録、台帳disable、Auth ban、緊急引継ぎを非公開runbookへ記録する。QR、secret、code、recovery materialをチケットや共有文書へ載せない。
- Supabase organizationへのアクセスにもMFAを要求し、production project権限を必要最小限にする。

設定根拠: [Auth TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)、[Supabase platform MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication)。

## 5. backup / PITR / privacy replay

採用plan、保持期間、保存地域、暗号化、RPO/RTOはここでは決めません。Dashboard表示だけで完了とせず、チェックリストへ実値とrestore証跡を残します。

1. [Database Backups](https://supabase.com/docs/guides/platform/backups)で対象planのdaily backupまたはPITR範囲を確認し、最古・最新restore pointと想定downtimeを記録する。
2. DB backupとは別の耐久領域へappend-onlyなprivacy replay台帳を保存する。許可する内容は `publicId`、`hide|delete`、`expectedVersion`、`idempotencyKey`、列挙済み理由だけで、本文、表示名、メール、通報補足、Auth token、DB内部IDを入れない。
3. 台帳の保存先、暗号化、改ざん防止、アクセス権、保持期間、backup、二名承認、監視を確定する。
4. restore中は通常/adminアプリを復旧先DBへ接続せず、公開配信と新規投稿を再開しない。
5. restore後にcustom roleのpasswordを再設定する。Supabaseのbackupはcustom role passwordを保存しないため、通常/admin roleを別passwordで再構成し、owner/provisionerの `NOLOGIN` と全roleの権限分離を再確認する。
6. backup取得後のhide/deleteを同じversion・冪等・監査付きmoderation関数で再適用する。公開範囲縮小を台帳対象に含める運用も、実装と保持方針を公開前に確定する。
7. API、HTML、RSC、metadata、OG/PNG、一覧、random、nearby、chunk、CDNで非公開内容が出ないことを確認してから、二名承認で配信を再開する。
8. stagingまたは隔離復旧環境で定期的にrestore時間と手順を実測する。production restoreそのものを訓練目的で実行しない。

Storage APIのobjectはdatabase backup本体に含まれません。現在P0の共有画像は都度生成ですが、将来Storageを使う場合はobject backup/restoreを別に追加します。ローカル訓練の再現方法は `docs/stage-g-setup.md` を参照してください。

## 6. monitoring / alerts / privacy

providerは未確定です。最低限、次のsignal、閾値、通知先、一次対応者、escalation、quiet hoursを公開前に設定します。閾値や時刻をこの文書から推測しません。

- `GET /api/health/live`: processが応答し、200 `{"status":"live"}`。失敗は配信・process障害として通知する。
- `GET /api/health/ready`: 公開設定が揃い、featured worldをDBから読めれば200 `{"status":"ready"}`、不足・DB照会失敗時は503 `{"status":"not_ready"}`。bodyへ不足key、host、例外、secretを出さない。SMTP、Turnstile、backup等は別monitor/E2Eで確認する。
- HTTP 5xx/429、DB接続待ち・pool枯渇、Auth error/rate limit、SMTP delivery/bounce、Turnstile failure、backup/PITR遅延、privacy replay書込み失敗。
- 投稿・編集・削除・通報・管理操作の失敗率、未処理通報、緊急停止状態。通報本文や願い本文を監視payloadへ送らない。
- host、Supabase、SMTP、Turnstile、監視providerのquota、利用量、費用通知、契約上限。

access log、APM、error tracker、analyticsへ、願い本文、表示名、メール、OTP、Cookie、Authorization、CAPTCHA token、DB URL、公開IDを送らないようallow-listで計装します。productionとstagingのdashboard/alertを分離し、synthetic checkは第9節のGETだけを使います。

## 7. 緊急の受付停止と再開

サービス全体やworldをarchivedにせず、対象worldの `posting_enabled` だけを変更します。停止中も可能な範囲で閲覧、本人削除、`public→unlisted`、`public本文→owner_only`、通報、管理操作を維持します。

1. incident ID、対象slug、固定された操作理由、判断者、実行者、開始時刻を記録する。
2. 通常手順では、個人のfresh Auth + TOTP AAL2 + enabled管理者台帳で管理画面へ入り、`PATCH /api/v1/admin/worlds/{slug}/posting` を使う。bodyは `postingEnabled`、`expectedPostingEnabled`、`reasonCode` だけで、reasonは `abuse / incident / maintenance / capacity / launch_control / other` の列挙値から選ぶ。現在値を確認してexpected valueを送り、操作ごとにUUID v4の `Idempotency-Key` を発行する。停止と再開で同じkeyを使い回さない。
3. 応答、worldの現在値、本文等を持たないDB監査記録が同じtransactionで確定したことを確認する。version/expected current競合は状態を再取得し、別の人の操作を上書きしない。複数worldを一括変更しない。
4. 停止後、world APIの `acceptingPosts=false`、新規作成の409 `POSTING_PAUSED`、既存の公開GETと本人削除・公開範囲縮小・通報を確認する。incident中にproductionへ不要な試験投稿を作らない。
5. 原因解消、readiness、DB/Auth/SMTP/rate limit、監視、privacy影響、受付期間を確認し、別の承認者が再開を承認する。同じ管理APIへexpected current valueと新しいIdempotency-Keyを送る。
6. 再開後の監査記録、`acceptingPosts` とerror rateを監視し、終了時刻、影響、恒久対応を記録する。
7. Authまたは管理API自体が利用不能な場合だけ、二名承認したbreak-glassとしてmigration/DBA接続をsecret managerから対話的に使い、`docs/stage-f-setup.md`「新規受付の一時停止」のexactly-one-row transactionを実行する。直接SQLを通常手順にせず、理由、実行SQLのhash、対象、前後値、実行者、時刻をincident記録へ残し、管理系復旧後に状態と監査の欠落を照合する。

`posting_enabled=true`でもworld stateや受付期間が条件を満たさなければ投稿は再開しません。Supabase project pause、feature gateの無関係な変更、デモfallbackを受付停止の代用にしません。

## 8. rollback / recovery判断

| 状況                    | 優先する対応                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| app releaseだけの不具合 | 受付停止が必要か判断し、DB互換を確認して直前の既知良好releaseへhost側rollback                    |
| 後方互換なDB不具合      | 受付停止、forward-fix migration、staging検証、production適用                                     |
| secret漏えい            | 受付停止の要否判断、該当secret/key/password/sessionを失効・rotation、log/影響調査                |
| 誤削除・DB破損          | 受付と配信を止め、第5節のrestore + privacy replay。再非公開化前に配信しない                      |
| privacy/権限漏えい      | 書込み停止だけで不十分なら公開配信も止める。cache purge、key/session失効、影響範囲確認、法的手順 |

古いappが新しいschemaと互換でない場合に、appだけをrollbackしません。migrationを履歴から削除したり、productionで`db reset`したり、確認なしにbackupへ戻したりしません。rollback後もread-only preflight、権限、公開範囲、monitoringを確認します。

## 9. read-only公開前検査

自動化は明示したorigin以外へredirectせず、Cookie・認証情報・bodyなしのGETだけを送り、作品、通報、Auth userを作成しません。まずstagingで次を実行します。

```bash
pnpm stage-h:preflight -- \
  --url 'https://<確定済みstaging origin>' \
  --environment staging \
  --world-slug '<確定済み4桁slug>'
```

検査対象はlive/ready、管理専用DB境界のoperations readiness、トップ、about、terms、privacy、world、world公開API、security headers、`robots.txt`です。stagingは `robots.txt` の `Disallow: /` とトップのnoindexを必須にし、HSTS/CSP不足を警告します。`--allow-http-loopback`はローカルmock専用で、public staging/productionでは使いません。

productionはapproval前ならready 503、全体noindex、`robots.txt`全拒否、新規匿名Auth/投稿503が正しいため、この時点でproduction向けpreflightの0終了を要求しません。§10のstaging E2Eと公開阻害項目を完了し、worldを管理APIで停止したうえで、チェックリスト§11の条件付きproduction検証windowを承認します。そこでだけ `PUBLICATION_APPROVED=true` を設定して再deployし、次を実行します。

```bash
pnpm stage-h:preflight -- \
  --url 'https://<確定済みproduction origin>' \
  --environment production \
  --world-slug '<確定済み4桁slug>'
```

productionは有効なHSTS、private pathを拒否するrobots、top/about/terms/privacy/featured worldだけのsitemapを必須とします。CSPは警告であり、導入時はNext.js scriptのnonce/hashと全主要経路を別途検証します。origin、環境、worldとcheck名以外のresponse bodyやsecretは出力しません。preflight後、承認window内だけworldを再開してproduction write E2Eとcleanupを行い、最終GOまで再停止します。失敗時は停止を維持し、approvalをfalseへ戻して再deployします。

## 10. staging E2Eとcleanup

書込みE2Eはproduction資格情報を一切持たないstagingで先に行います。

1. test run ID、release commit、実行者、開始時刻を作り、願いと表示名を明確なテストデータにする。実利用件数・公開実績へ集計しない環境を使う。
2. 独立した二つのbrowser sessionで、閲覧時にAuth userが増えないこと、投稿、固有URL、公開/owner-only、public/unlisted、共有URL/PNG、招待、枠競合、冪等再送を確認する。
3. メール連携、別browserのOTP復帰、本人編集、version競合、削除をcustom SMTPとTurnstileの実providerで確認する。
4. 通報し、AAL2管理者が通報を確認できること、通報だけで自動非表示にならないことを確認する。必要なhide/restoreはstagingだけで行う。
5. 360/390/768/1440px、実端末のtouch/pinch、キーボード、VoiceOver/TalkBack、X/LINE、Clipboard、SNS crawlerを記録する。
6. testで得たpublic ID、report ID、Auth UID等をアクセス制限したrun ledgerへ記録し、owner delete、通報dismiss/resolve、管理者台帳disable、試験Auth user削除等の承認済み手順でcleanupする。秘密、OTP、本文をledgerへ残さない。
7. 公開一覧、個別、OG/PNG、chunk、管理queue、Auth users、analyticsからtest artifactが意図どおり除外・削除されたことを確認し、終了時刻と残件を記録する。

P0の段階H完了条件には、実productionを対象に投稿・共有・本人編集・削除・通報を確認する作業が残ります。これはpreflightに含めず、§9の条件付きproduction検証windowで、識別済みtest投稿、cleanup、実績除外、監視、失敗時の即時停止とapproval取消しを伴って手動実施します。承認がない間は未完了としてチェックリストに残します。

## 11. 現在の外部未完了項目

リポジトリ内だけでは次を完了できません。

- 実production/staging domain、HTTPS、HSTS、DNS、host project/region/権限
- 別々のcloud Supabase project、plan、DB version、pooler、SSL enforcement、network restriction
- world slug/state/受付期間/公開承認、運営者、問い合わせ、規約日、各保存方針
- custom SMTP、送信domain、Turnstile widget、実proxy chain、HMAC secret
- production管理者UUID、TOTP、organization MFA、復旧担当
- backup/PITR、privacy replay保存先、RPO/RTO、restore訓練、role password再設定
- monitoring/alert/on-call/escalation、費用上限と利用量通知
- staging実端末E2E、production手動write E2Eとcleanup

Supabase側の公開前確認には、[Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)、[Security Advisors](https://supabase.com/docs/guides/observability/advisors)、[SSL Enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)、[Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions)を使います。2026-11-03時点では、[HTTP APIの旧TLS 1.2 CBC cipher廃止予定](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)も告知されているため、実利用clientとsynthetic monitorが現行TLSへ対応することを公開判断日に再確認します。
