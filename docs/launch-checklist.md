# えまのわ P0 公開チェックリスト

このファイルは公開ごとに複製し、空欄を実値と証跡で埋めるテンプレートです。チェック、担当者名、日時、証跡がない項目は未完了です。仕様書の提案日程、架空のdomain・運営情報、`<...>` のplaceholderを公開承認に使いません。secret、OTP、Cookie、token、DB URL、願い本文、メールを証跡へ貼りません。

## 0. release記録

| 項目                                      | 記録 |
| ----------------------------------------- | ---- |
| release / commit                          |      |
| チェック開始・終了（JST）                 |      |
| release担当                               |      |
| 運用承認者                                |      |
| privacy / 公開文書承認者                  |      |
| staging origin / deployment ID            |      |
| production origin / deployment ID         |      |
| staging / production Supabase project ref |      |
| featured world slug                       |      |
| incident / rollback連絡先                 |      |

## 1. 値と公開文面の承認

- [ ] productionの `APP_ORIGIN` は承認済みHTTPS bare originで、path/query/fragment/userinfo/localhostを含まない。証跡:
- [ ] stagingは別のHTTPS origin、host project、Supabase project、secret、analytics、monitorを使う。証跡:
- [ ] `OPERATOR_NAME` は実際の公開主体として承認済み。担当・日付:
- [ ] `CONTACT_URL` は実際に受け付けるHTTPS窓口で、担当者が応答試験済み。証跡:
- [ ] `POLICY_EFFECTIVE_DATE` は承認済みの規約・privacy文面と一致する。証跡:
- [ ] `CONTENT_RETENTION_NOTICE` は作品、削除後tombstone、通報・監査の実際の保持と一致する。証跡:
- [ ] `BACKUP_RETENTION_NOTICE` は実backup/PITR設定と復旧時の再非公開化を正確に説明する。証跡:
- [ ] `LOG_RETENTION_NOTICE` はhost、DB、Auth、SMTP、WAF/APM/analytics等の実保持と一致する。証跡:
- [ ] aboutは独立した参加型サービスであることを説明し、未確認の神社・宗教団体との提携、祈祷、奉納、宗教上の効力を表示しない。証跡:
- [ ] privacyはpublic/unlistedとpublic/owner_onlyの違い、URL限定の限界、削除、外部cache、backup、問い合わせを実挙動どおり説明する。証跡:
- [ ] terms/privacy/aboutにplaceholder、架空の実績、未実装P1/P2、仮価格・仮日程がない。証跡:

## 2. worldと公開承認

| world項目             | 承認値 / 証跡 |
| --------------------- | ------------- |
| slug / 表示名         |               |
| state                 |               |
| 受付開始UTC / JST表示 |               |
| 受付終了UTC / JST表示 |               |
| `posting_enabled`     |               |
| 日程・時差の承認者    |               |

- [ ] `opens_at <= DB now < closes_at` の半開区間、DB UTC、UI JSTを確認した。証跡:
- [ ] preview/open/archivedで新規・編集・削除・公開範囲縮小が仕様どおり。証跡:
- [ ] `FEATURED_WORLD_SLUG` は現在年から自動推測せず、承認したworldを指す。証跡:
- [ ] §11の条件付きproduction検証windowが承認されるまで `PUBLICATION_APPROVED=true` にしていない。証跡:
- [ ] `publicationReady` と `world.acceptingPosts` を混同せず、受付外でも安全な閲覧deploymentがreadyになり得ることを監視担当が理解した。担当:

## 3. build / configuration / secret

- [ ] Node/pnpm/lockfileはrelease commitどおりで、`pnpm install --frozen-lockfile` が成功。証跡:
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` が同commitで成功。証跡:
- [ ] localの `pnpm test:stage-g` がclean DBで成功し、実行環境・結果・残件を記録した。証跡:
- [ ] `EMANOWA_ENVIRONMENT=production`、`EMANOWA_DATA_MODE=database` を明示し、demo fallbackを拒否する。証跡:
- [ ] groups / fulfillment / paymentsはserver側でもfalse。world APIのcapabilitiesもfalse。証跡:
- [ ] browserへ公開するのはSupabase URL / publishable key / Turnstile site keyだけ。証跡:
- [ ] DB/admin/migration URL、SMTP、CAPTCHA secret、HMAC secret、OTP/tokenがbundle、HTML、RSC、source map、logにない。証跡:
- [ ] `DATABASE_URL` と `ADMIN_DATABASE_URL` は環境専用の別secret・別poolで、migration credentialはruntimeにない。証跡:
- [ ] remote DB URLは明示TLS、DB側SSL enforcementを有効化。必要なnetwork restrictionと接続元を確認した。証跡:
- [ ] `RATE_LIMIT_HMAC_SECRET` は環境別の32byte以上、`TRUSTED_PROXY_HOPS` は実CDN/proxy header chainで確認済み。証跡:
- [ ] secret rotation担当、失効手順、最終rotation日を非公開運用記録へ残した。証跡参照:

## 4. migration / database security

- [ ] 対象project ref、region、DB version、release migration集合を二名照合した。担当・日付:
- [ ] stagingで `migration list` → `db push --dry-run --skip-vault` → review → push → listを実施した。証跡:
- [ ] staging E2E/cleanup後、同じreleaseをproductionでdry-run/review/applyした。証跡:
- [ ] remoteへseed、`db reset`、local fixture、無承認の`--include-all`を実行していない。確認者:
- [ ] `app_private` はData API非公開で、全tableのRLS/権限、固定search path、関数execute allow-listを確認した。証跡:
- [ ] `emanowa_app` / `emanowa_admin_app` は別passwordのLOGIN、`NOINHERIT/NOBYPASSRLS/NOSUPERUSER`。owner/provisionerはNOLOGIN。証跡:
- [ ] 通常roleが管理関数を、管理roleが通常投稿・通報関数やprivate tableを直接使えない。証跡:
- [ ] Supabase Security/Performance Advisorsを確認し、未解決項目の受容者と期限を記録した。証跡:
- [ ] 対象Postgres versionのSupabase changelogを公開日に再確認し、該当するupgrade/reindex/crypto対応を実施した。証跡:

## 5. Auth / SMTP / Turnstile / admin

- [ ] Supabase Auth Site URLは各環境の `APP_ORIGIN` と一致し、productionにlocalhost/preview/wildcard redirectがない。証跡:
- [ ] Anonymous Sign-Insとmanual linkingを有効化し、閲覧GETだけではAuth userを作らない。証跡:
- [ ] production custom SMTP、sender、SPF/DKIM/DMARC、quota、bounce/complaint、alertを確認した。証跡:
- [ ] メール連携・復帰用6桁OTP template、到達、再送、期限切れ、既存メール競合、未登録宛先の同一応答をstagingで確認した。証跡:
- [ ] staging/production別Turnstile widgetは実hostだけを許可し、site/secretを正しい環境とSupabase Authへ設定した。証跡:
- [ ] CAPTCHA欠落・失効・再利用・provider障害、Auth/rate-limit store障害は書込みをfail closedにする。証跡:
- [ ] 管理者は個人UUID、確認済みメール、TOTP AAL2、enabled台帳、管理DB接続をすべて満たす。証跡:
- [ ] AAL1、一般利用者、台帳外AAL2、無効化済み管理者を拒否する。証跡:
- [ ] Supabase organization MFA、最小権限、factor紛失・退職・緊急disable手順を確認した。証跡:

## 6. 公開範囲・所有権・同時実行

- [ ] public/public、public/owner_only、unlisted/public、unlisted/owner_onlyをHTML/API/RSC/OG/PNG/一覧/chunkで確認した。証跡:
- [ ] 他人の更新・削除、client指定owner/admin属性、通常roleの直接table参照を拒否する。証跡:
- [ ] 同一枠の同時投稿は成功1件、同一UIDの別枠同時投稿も1枚まで。証跡:
- [ ] 同じ冪等key/bodyは同じ結果、異なるbodyは拒否し、通信切断後も結果を復元する。証跡:
- [ ] version競合が新しい本文を上書きせず、枠競合・429・障害時も下書きとkeyを保持する。証跡:
- [ ] deleteは本文・表示名を抹消し、旧public IDを再利用しない。hide/delete/privacy縮小後に全公開経路と管理下cacheから原文が出ない。証跡:
- [ ] 通報だけで作品を自動非表示にせず、一般利用者は管理APIを使えない。証跡:

## 7. backup / recovery / emergency

| 復旧項目                   | 承認値 / 証跡 |
| -------------------------- | ------------- |
| backup方式・保持・region   |               |
| PITR earliest/latest point |               |
| RPO / RTO                  |               |
| restore担当 / 承認者       |               |
| privacy replay保存先・保持 |               |
| 最終restore drill          |               |

- [ ] backup/PITRが実際に有効で、失敗・遅延alertを受信できる。証跡:
- [ ] privacy replay台帳はbackupと別の耐久領域、append-only、暗号化、改ざん防止、最小権限、監視付き。証跡:
- [ ] 台帳に願い本文、表示名、メール、通報補足、token、DB内部IDを保存しない。確認者:
- [ ] restore後のcustom role password再設定、owner/provisioner NOLOGIN、Auth/SMTP/Turnstile/rate limit再確認手順がある。証跡:
- [ ] 古いbackupの公開巻き戻りを再現し、hide/delete/privacy縮小を再適用して全公開経路を確認するまで配信を再開しない。証跡:
- [ ] fresh Auth + TOTP AAL2 + enabled台帳の管理者が、`PATCH /api/v1/admin/worlds/{slug}/posting` へ `postingEnabled`、`expectedPostingEnabled`、列挙 `reasonCode`、操作ごとのIdempotency-Keyを送り、1 worldだけを停止・再開できる。証跡:
- [ ] 停止・再開の本文なしDB監査、冪等再送、expected current競合を確認した。証跡:
- [ ] Auth/admin API障害時だけ使うexactly-one-row SQLのbreak-glassは二名承認、secret manager、前後値・実行者・時刻の記録、復旧後照合を必須にした。証跡:
- [ ] 停止中も閲覧、本人削除、公開範囲縮小、通報、管理操作を可能な範囲で維持する。証跡:
- [ ] app rollback、forward-fix migration、secret漏えい、privacy incidentの分岐と連絡先を当番へ引き継いだ。証跡:

## 8. monitoring / alerts / cost

- [ ] live非200、ready非200、HTTP 5xx/429、DB pool、Auth、SMTP、Turnstile、backup/PITR、privacy ledgerを監視する。証跡:
- [ ] 各alertの閾値、評価時間、通知先、一次担当、escalation、acknowledge方法を確定した。証跡:
- [ ] synthetic monitorはGETだけで、Cookie、認証情報、body、production writeを使わない。証跡:
- [ ] log/APM/error/analyticsはallow-listで、本文、表示名、メール、公開ID、完全URL、OTP/token/Cookieを収集しない。証跡:
- [ ] staging/productionのdashboardと通知先を区別する。証跡:
- [ ] host、Supabase、SMTP、Turnstile、monitoringのplan、quota、費用上限、利用量通知を確認した。証跡:
- [ ] on-call、通報一次対応、違法・緊急内容、privacy/security incidentの窓口と応答目標を確定した。証跡:

## 9. staging E2E / cleanup

| 試験記録               | 値  |
| ---------------------- | --- |
| test run ID / commit   |     |
| 実行者 / 開始・終了    |     |
| test data ledger       |     |
| cleanup担当 / 完了時刻 |     |
| 残件・期限             |     |

- [ ] production資格情報を持たないstagingで、二つの独立browser sessionを使った。証跡:
- [ ] 投稿、共有、招待、本人編集、version競合、削除、通報、管理確認を実providerで完走した。証跡:
- [ ] public/owner_only/unlisted、同時投稿、冪等性、429/503、OTP/CAPTCHA、AAL2を確認した。証跡:
- [ ] 360/390/768/1440px、実端末touch/pinch、keyboard、VoiceOver/TalkBack、reduced motionを確認した。証跡:
- [ ] X/LINE、Clipboard、PNG、OG/SNS crawlerを代表端末で確認した。証跡:
- [ ] test投稿は明示して追跡し、owner delete、report解決、admin disable、試験Auth user等をcleanupした。証跡:
- [ ] test artifactを実績・production analyticsへ含めず、一覧/API/画像/admin/Auth/analyticsの残存を確認した。証跡:

## 10. production候補の公開前read-only確認

- [ ] DNS/TLS certificate/HTTPSを外部から確認した。証跡:
- [ ] production配信基盤が有効なHSTSを付与する。証跡:
- [ ] `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、frame防御があり、`X-Powered-By`がない。証跡:
- [ ] CSP未導入の場合は警告と残存risk/担当/期限を承認した。導入した場合はnonce/hashと主要経路を検証した。証跡:
- [ ] approval前はliveだけ200、readyは503 `{"status":"not_ready"}`、`robots.txt`は`Disallow: /`、トップはnoindexであり、新規匿名Auth/投稿が503になる。証跡:
- [ ] production資格情報を持たないstagingで、次のGET-only preflightが0で終了した。証跡:

```bash
pnpm stage-h:preflight -- \
  --url 'https://<確定済みstaging origin>' \
  --environment staging \
  --world-slug '<確定済み4桁slug>'
```

- [ ] stagingのreadyとoperations readinessは200 `{"status":"ready"}`、不足時は503 `{"status":"not_ready"}`だけでsecretや不足項目を返すことなく検証を止める。証跡:
- [ ] stagingのtop/about/terms/privacy/world/world APIが承認候補の内容を返し、placeholder、demo、開発者専用機能がない。証跡:

## 11. 条件付きproduction検証window（明示承認が必要）

この節は最終公開の前にproductionを一時的にindexable/write-capableへ変えるため、§0〜10の公開阻害項目が解消し、停止条件・rollback・担当を含む条件付き承認が必要です。開始時はAAL2管理APIでworldの新規受付を停止し、失敗時は停止を維持して `PUBLICATION_APPROVED=false` へ戻し再deployします。

- [ ] 実施日時、公開影響、test識別方法、cleanup、metrics除外、停止条件を条件付き承認した。承認者:
- [ ] AAL2管理APIで対象worldを停止し、`acceptingPosts=false` と新規作成P1004を確認した。証跡:
- [ ] 条件付き承認後にだけ `PUBLICATION_APPROVED=true` を設定して再deployし、world停止中のままproduction向けGET-only preflightが0で終了した。証跡:
- [ ] productionのready/operations readinessは200、`robots.txt`は全拒否せずprivate pathを拒否し、sitemapはtop/about/terms/privacy/featured worldだけ、公開ページに意図しないnoindexがない。証跡:
- [ ] 検証開始直前にworldを再開し、対象1件以外の新規投稿や異常な5xx/429があれば直ちに再停止する監視を有効にした。証跡:
- [ ] 明示したtest投稿1件だけを作成し、固有URL/共有/owner edit/privacy縮小を確認した。証跡:
- [ ] 通報を作成し、AAL2管理者が確認でき、作品が自動非表示にならないことを確認した。証跡:
- [ ] owner deleteとreport cleanupを行い、個別/HTML/RSC/OG/PNG/一覧/chunk/admin/analyticsに意図しないartifactが残らない。証跡:
- [ ] test投稿・通報を公開実績、参加件数、KPIに含めていない。証跡:
- [ ] cleanup後にworldを再停止し、最終GOまで新規投稿を閉じた。証跡:

## 12. go / no-go

- [ ] 未解決項目を一覧化し、公開阻害 / 期限付きrisk受容 / 公開後対応へ分類した。証跡:
- [ ] privacy・security・復旧・問い合わせ・費用に公開阻害の未完了がない。確認者:
- [ ] rollback対象release、緊急停止、連絡網、当番を再確認した。確認者:
- [ ] §11のproduction E2E/cleanupが完了し、test artifactも残っていない。証跡:
- [ ] GOの場合、承認したworld state・受付期間・`posting_enabled`へ設定し、`PUBLICATION_APPROVED=true`を維持してproduction preflight、主要公開ページ、monitor/alertを再確認した。証跡:
- [ ] NO-GOの場合、world停止、`PUBLICATION_APPROVED=false`、再deploy、ready 503、全体noindex/robots拒否、当番通知を確認した。証跡:

最終判断: `GO / NO-GO`

運用承認者・日時:

privacy / 公開文書承認者・日時:

技術承認者・日時:
残存riskと期限:

## 13. 公開直後

- [ ] live/ready、5xx/429、Auth/SMTP/Turnstile、DB、通報queue、費用を承認した観測windowで監視した。証跡:
- [ ] unexpectedなtest/demo data、secret、placeholder、indexing設定がない。証跡:
- [ ] 受付停止・rollback・escalationが必要か判断し、判断時刻を記録した。証跡:
- [ ] release記録、検証結果、残件、incidentを秘密を除いて保管した。保存先:
