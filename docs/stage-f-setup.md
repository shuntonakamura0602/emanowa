# 段階F — 通報・運用・不正利用対策の設定・確認手順

この文書は、通報、管理者MFA、非表示・復帰・削除、監査記録、複数instanceで共有する回数制限をローカルまたはstagingで確認する手順です。通常投稿用DB接続と管理用DB接続は分離し、管理画面を表示できることだけをAPI権限として扱いません。

## ローカル自動検証

Docker Desktopを起動し、リポジトリで固定したNode.jsと依存関係を選びます。

```bash
nvm use
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm test:stage-f
```

注意: `test:stage-f` はローカルSupabase DBの全データを削除し、migrationから再作成します。必要なローカルデータは先に退避してください。hostとportを検査してremote DBでは実行を拒否します。

`test:stage-f` はローカルhostとPostgresの既定port `54322` を確認し、remote API/DBや `EMANOWA_ENVIRONMENT=staging|production` では実行を拒否します。処理内容は次のとおりです。

- 全migrationをクリーンDBへ適用し、段階B〜FのpgTAPとDB lintを実行する
- 段階B〜Eの所有権、同時投稿、本人管理、地図、共有、招待を回帰確認する
- 通報の201、同じ冪等keyの再送、別keyで同じopen通報を送った場合の200を確認する
- 通報だけでは作品が非表示にならず、危険なHTML文字列もplain textとして返ることを確認する
- 2つのproduction Next.js instanceが同じDB bucketを使い、作成・編集・通報・画像・OTPの境界と429の `Retry-After` を共有することを確認する。通報・画像・管理非表示は並行要求も送り、成功件数、重複行、監査件数をDBで照合する
- 制限関数を一時的に利用不能へして、公開JSONは読める一方、保存要求が503で閉じることを確認する
- 実Supabase Authで確認済みメールとTOTPを用意し、SSR CookieのAAL2セッションだけが管理APIを利用できることを確認する
- 未認証、一般利用者、AAL1、有効台帳にないAAL2、無効化された管理者を拒否する
- 管理者の非表示・復帰・削除、version競合、冪等再送、通報解決、公開詳細・一覧・random・nearby・chunk・HTML・metadata・RSC・OG・正方形PNG、本文を持たない監査記録を確認する

試験後もローカルfixtureは残ります。通常の開発データへ戻す場合は `pnpm db:reset`、サービスを止める場合は `pnpm supabase:stop` を実行します。

## DB接続とロール分離

段階Fのmigrationは、全ロールを `NOLOGIN`、`NOINHERIT`、`NOBYPASSRLS` で作成します。環境provisioning時に通常/adminアプリの2ロールだけを `LOGIN` へ変更し、owner/provisionerは常に `NOLOGIN` のままにします。

- `emanowa_app`: 公開・本人API、通報作成、共有rate limitだけを実行する通常BFFロール
- `emanowa_admin_app`: MFA確認後の管理一覧・作品操作・通報状態変更だけを実行する管理BFFロール
- `emanowa_admin_provisioner`: migration sessionが管理者台帳を有効化・無効化する間だけ一時利用するロール。LOGIN資格情報は持たせない
- `emanowa_owner`: private object所有者。アプリ接続には使わない

ローカルではmigration適用後に次を実行します。

```bash
pnpm db:local-role
```

表示された別々のURLを `.env.local` の `DATABASE_URL` と `ADMIN_DATABASE_URL` へ設定します。通常APIへ管理接続を設定したり、管理APIへ通常接続を設定した場合は設定エラーになります。`MIGRATION_DATABASE_URL` はmigration、管理者台帳更新、運用変更専用で、実行時アプリへ渡さないでください。

実行時の両URLも接続前に同じ契約で検証します。username、password、host、port、databaseはURL authority/pathへすべて明示し、`PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` 等のprocess環境から補完しません。loopback以外は `sslmode=require|verify-ca|verify-full` のいずれかを明示し、queryには重複のない小文字の `sslmode`、`sslrootcert`、`sslcert`、`sslkey`、`sslnegotiation` だけを指定できます。queryからhost、user、password、port、database、options、各timeoutを上書きするURLや `sslmode=no-verify` は拒否します。検証後はraw connection stringをdriverへ渡さず、接続先、UTF-8、session options、非replication、timeout、TLSを構造化configで固定するため、ambient `PGOPTIONS`、`PGCLIENTENCODING`、`PGREPLICATION`、`PGSSLMODE` 等も契約を変更しません。Supavisorのusernameは `emanowa_app.<project-ref>` / `emanowa_admin_app.<project-ref>` を利用でき、role prefixを検査した後も完全なusernameを接続へ渡します。

cloudではmigration適用後、providerでmigration/DBA権限を持つdirectまたは対応session endpointであることを確認した接続を使い、通常/adminアプリroleだけを `LOGIN` へ変更して異なるランダムパスワードを対話入力します。remote URLは少なくとも `sslmode=require`、可能ならprovider CAを使う `sslmode=verify-full` とし、DB側のSSL enforcementも有効にします。`psql` の `\password` は秘密をSQL文字列やshell historyへ入れません。

```text
PGHOST='<provider DB host>' \
PGPORT='5432' \
PGDATABASE='postgres' \
PGUSER='<migration/DBA role>' \
PGSSLMODE='verify-full' \
psql -W
\password emanowa_app
\password emanowa_admin_app
ALTER ROLE emanowa_app LOGIN;
ALTER ROLE emanowa_admin_app LOGIN;
\du emanowa_app
\du emanowa_admin_app
\du emanowa_admin_provisioner
\du emanowa_owner
\q
```

`psql -W` でmigration/DBA passwordを対話入力し、passwordを接続URLやprocess argvへ含めません。provider CAが必要なら権限を限定したCA fileを `PGSSLROOTCERT` で指定します。代替として権限0600の `PGSERVICEFILE` / `PGPASSFILE` を利用できますが、`.env.local` や実行時アプリ環境には置きません。作成した別々のtransaction pooler URLは、実行環境の `DATABASE_URL` と `ADMIN_DATABASE_URL` へ別secretとして保存します。パスワードや接続URLをmigration、ログ、ブラウザーbundle、チケットへ記録しません。確認時に `emanowa_admin_provisioner` と `emanowa_owner` は `NOLOGIN` のまま、通常/adminアプリroleは `NOSUPERUSER`、`NOINHERIT`、`NOBYPASSRLS` のままであることを確認します。

## 管理者の有効化・無効化

先に対象者が通常の本人導線でメール確認を完了していることを確認し、Auth user UUID v4だけを受け取ります。メールアドレスをCLI引数、ログ、台帳の役割判定に使いません。

```bash
printf '%s' 'MIGRATION_DATABASE_URL: '
IFS= read -r -s MIGRATION_DATABASE_URL
printf '\n'
export MIGRATION_DATABASE_URL
ACTION=enable # 無効化する操作ではdisableへ変更する
pnpm admin:access -- "$ACTION" 00000000-0000-4000-8000-000000000000
unset MIGRATION_DATABASE_URL
```

実際には実行する操作を `enable` または `disable` の一方だけ選び、UUID v4を指定してください。接続URLは上のように非表示入力するか、利用中のsecret managerからそのコマンドの環境へ注入し、shell historyへ直書きしません。`MIGRATION_DATABASE_URL` には、username、password、host、port、databaseを明示し、`auth.users` を照会でき、作成済み `emanowa_admin_provisioner` を一時GRANT/REVOKEできるmigration/DBA接続が必要です。provider側でdirectまたはDDL/GRANT対応session endpointであることを確認し、remote URLへ `sslmode=require|verify-ca|verify-full` のいずれかがない場合はCLIが接続前に拒否します。通常/adminアプリ接続やambient `PG*` による不足値・session/TLS設定の補完も拒否または固定値で無効化します。enable時に確認済みメール、非匿名、未削除、現在非banであることをDB内で確認しますが、メール列は取得・出力しません。専用provisionerへのmembership、actor UUID、台帳更新、membership revokeは1つのtransactionで行い、失敗時は全てrollbackします。disableはAuth状態が変化していても既存台帳を即時無効化でき、次の管理API要求から403になります。管理者をAuth側でbanする場合も台帳をdisableし、後日のunbanだけで管理権限を自動復帰させません。

`/admin` は次の三層をそれぞれ確認します。

1. 検証済みJWTとfreshなAuth userが同一UIDで、匿名ではなくメール確認済みである
2. セッションのAuthenticator Assurance Levelが `aal2` である
3. 管理専用DB接続が `admin_users` の現在値を毎回確認し、`enabled=true` である

未登録の確認済み利用者は `/admin` でTOTPを登録し、QRまたは秘密鍵を本人の認証アプリへ取り込んで6桁コードを確認できます。QR、秘密鍵、コード、factor/challenge情報はReactの一時状態とSupabase Auth SDK内だけで扱い、URL、Web Storage、計測、アプリログへ保存しません。AAL2になっても台帳が無効なら管理一覧は表示しません。

cloud SupabaseではDashboardのAuth MFA設定でTOTP enrollment/verificationを有効にします。ローカル設定は `supabase/config.toml` の `[auth.mfa.totp]` で両方を有効にしています。管理者は復旧用コードやfactor再登録手順を運営の非公開手順として別管理し、共有アカウントを使わないでください。

## 共有rate limit

初期値はサーバーとDB関数の両方で固定し、利用者入力で変更できません。

| 操作                      |        制限 | 識別子                     |
| ------------------------- | ----------: | -------------------------- |
| 新規配置                  |   10回/60秒 | Auth UID                   |
| 本人編集                  |  30回/600秒 | Auth UID                   |
| 通報                      | 5回/3,600秒 | Auth UID                   |
| 画像生成                  |   30回/60秒 | 信頼済み送信元             |
| OTP要求                   |    1回/60秒 | NFC・小文字化した宛先      |
| OTP確認（メール追加）     |   5回/600秒 | fresh匿名UID               |
| OTP復帰確認（送信元全体） |  30回/600秒 | 信頼済み送信元             |
| OTP復帰確認（宛先全体）   |  30回/600秒 | 正規化宛先                 |
| OTP復帰確認（組ごと）     |   5回/600秒 | 正規化宛先＋信頼済み送信元 |

生のUID、メール、IPはrate limit tableへ保存しません。`RATE_LIMIT_HMAC_SECRET` でactionごとのHMAC-SHA-256へ変換します。この値はdevelopmentを含む全環境の変更要求で必須で、手動ローカル起動では `openssl rand -hex 32` の出力を `.env.local` に設定します。staging/productionでは32バイト以上のランダム秘密をsecret managerから設定します。値を変更すると既存bucketとは別の識別子になるため、通常のsecret rotationと同様に切替時刻を管理してください。

画像の送信元はクライアント指定headerを直接信用せず、信頼するreverse proxyが付加する `X-Forwarded-For` の右側から `TRUSTED_PROXY_HOPS` で選びます。実際のCDN/host構成でhop数を確認し、staging/productionでは未設定・不正headerを503で拒否します。送信元はHMAC前にcanonicalizeし、圧縮・展開表記が異なる同じIPv6は一つのIPv6 subjectへ、IPv4-mapped IPv6は対応するIPv4 dotted-decimalと同じsubjectへ揃えます。表記差による別bucket化を許しません。共同回線のIPを本人の投稿・編集・通報・OTP送信のクォータには使いません。OTP復帰確認では信頼済み送信元を、送信元全体と宛先との組の二つの制限subjectに使いますが、本人識別や権限の根拠にはしません。

OTPは暦分の固定windowではなく、正規化した同一宛先へ要求時刻から連続60秒のcooldownを適用します。送信前にopaqueなUUIDで1枠をDB予約し、Auth providerが送信していないと明示できるCAPTCHA拒否、メール競合、link要求のprovider rate limitだけ一致予約を解放します。送信有無が不明なprovider/通信障害は消費済みのままにし、別の並行要求が確保した枠を戻しません。

6桁コードの確認は送信予約と独立して制限します。メール追加は確認済みの現在の匿名UIDに対して5回/10分です。別端末復帰は、(1) 同一の信頼済み送信元から全宛先を横断して30回/10分、(2) 同一の正規化宛先へ全送信元を横断して30回/10分、(3) 正規化宛先と信頼済み送信元の同じ組で5回/10分、という三つの共有上限をすべて通過する必要があります。順に、宛先を切り替える試行、送信元を切り替える試行、同じ組への局所試行を抑えます。集約上限を組ごとの上限より高くすることで、単一の宛先または送信元を知る第三者が少数回で広範囲の確認枠を塞ぐ影響も抑えます。いずれか一つでも上限に達した場合は429、`Retry-After`、`retryAfterSeconds`で待機を案内します。

三層判定は3回の独立したcounter消費ではありません。専用DB関数が1 transactionで三つのsubjectを決定的な順序でadvisory lockし、原子的に判定します。組の上限が枯渇した要求は組のbucketだけを更新し、宛先全体・送信元全体をpoisonしません。送信元全体または宛先全体が枯渇した要求は該当する広域軸だけを更新し、宛先・送信元をローテーションするたびに新しい組やもう一方の広域軸のbucketを作りません。復帰用action `otp_verify`、`otp_verify_target`、`otp_verify_source` は汎用 `consume_rate_limit` のallow-list外で、専用三層関数だけが更新します。メール追加の確認だけは独立action `otp_verify_link` を汎用関数で5回/600秒消費します。

上限超過は429 JSON、`Retry-After` header、`retryAfterSeconds`を返し、画面は入力と同じ冪等keyを保持して本人の再試行を待ちます。共有storeや設定が利用不能な変更要求は503で閉じ、公開JSONの閲覧は継続します。process内Mapや設定不足時のdemo fallbackはありません。初期値を変更する場合は、アプリ定数とDB allow-listを同じreview済みmigrationで変更し、複数instance試験を再実行します。

## CAPTCHAとSupabase Auth側の制限

staging/productionではCloudflare Turnstileを匿名Authとメール復帰要求に必須とします。

```text
NEXT_PUBLIC_CAPTCHA_SITE_KEY=公開site key
CAPTCHA_SECRET_KEY=サーバー専用secret
```

同じsecretをSupabase DashboardのAuth CAPTCHA providerへ設定し、Anonymous Sign-Insを有効にします。site keyだけをブラウザーへ渡し、tokenは要求ごとに破棄します。どちらかの設定がない、providerを検証できない、またはtokenがない公開環境の新規Auth要求は、開発モックへ切り替えず422/503で閉じます。

Auth側にもanonymous sign-inとOTP送信のrate limitを設定し、アプリ側の共有DB制限と両方を有効にします。上限は本番トラフィック、SMTP/provider制約、不正利用実績に合わせてstagingで確認してください。

## 通報と運営操作

通報は確認済み匿名または登録セッションで送れます。同じUID・同じ絵馬のopen通報は1件だけで、別の冪等keyでも既存report IDを200で返します。理由は列挙値、補足は200書記素・UTF-8 2KiB以内のplain textです。通報件数だけでは作品を自動非表示にしません。

管理一覧は通報者UID、owner-only本文、管理DB内部IDを返しません。作品のhide/restore/deleteと、通報のresolved/dismissedは別操作です。作品操作はexpected version、UUID v4のIdempotency-Key、列挙された理由を必須とし、公開投影・占有・chunk集計と同じtransactionで更新します。

- hide: 公開投影を削除し、本人枠と占有は保持する
- restore: 現在の公開設定から投影を再作成する。deletedからは戻さない
- delete: 本文と表示名をNULLにし、投影と占有を削除する。旧公開IDは再利用しない
- audit: admin UID、対象ema内部ID、列挙action/reason、前後状態、時刻だけを保存し、本文、表示名、通報補足、メールを保存しない

hidden/deletedは公開詳細、一覧、random、chunk識別情報、HTML/RSC、metadata、OG/正方形PNGから404または占有だけの応答になります。owner-only本文は管理一覧にも出しません。

## 新規受付の一時停止

不正利用や障害時に新規配置だけを止める場合は、migration/運用接続で対象worldの `posting_enabled=false` を設定します。worldをarchivedへ変更しません。新規作成は409 `POSTING_PAUSED`になり、閲覧、本人削除、公開範囲の縮小、通報、管理操作は継続します。再開は同じ接続で `posting_enabled=true` とし、DB現在時刻、world state、受付期間の条件も満たすことを確認します。

上のTLS・対話password手順で接続した `psql` sessionで、対象slugと新しい値を明示して次を実行します。`slug` は一意制約を持ち、更新が0行なら `1 / count(*)` がtransactionを失敗させるためcommitされません。停止時は `false`、再開時は内容を確認して `true` の一方だけを実行します。

```sql
\set ON_ERROR_STOP on
\set world_slug '2027'
\set new_posting_enabled 'false'

begin;
with updated as (
  update app_private.worlds
     set posting_enabled = :'new_posting_enabled'::boolean
   where slug = :'world_slug'
  returning slug, posting_enabled
)
select min(slug) as updated_slug,
       bool_and(posting_enabled) as posting_enabled,
       1 / count(*) as exactly_one_row
  from updated;
commit;
```

変更前後に対象slug、変更者、変更時刻、理由を運営記録へ残します。migration接続を常駐アプリやブラウザーへ渡さず、複数worldを一括更新しません。

## staging / production確認

1. `DATABASE_URL` と `ADMIN_DATABASE_URL` が異なるsecretで、各roleが `NOSUPERUSER`、`NOINHERIT`、`NOBYPASSRLS` である。DB側SSL enforcementを有効にし、remoteのmigration/DBA接続は `sslmode=require` 以上、可能ならCA検証付きである。
2. 通常roleが管理関数を実行できず、管理roleが通報作成・通常投稿関数やprivate tableを直接操作できない。
3. TOTPが有効で、未認証/AAL1/非管理者/無効管理者が管理APIを利用できない。
4. CDN/reverse proxyの実header chainで `TRUSTED_PROXY_HOPS` を決め、偽装headerと制限store障害がfail closedになる。
5. 2つ以上のinstanceへ交互に要求し、429状態、冪等性、version競合が共有される。
6. hide/delete直後のすべての公開URLと画像が本文を返さず、CDNが `no-store` 応答を保持しない。
7. Turnstile、Auth側rate limit、SMTP到達性、OTP再送間隔を実providerで確認する。
8. 通報担当、一次対応時間、違法・緊急内容のエスカレーション、問い合わせ先、管理者無効化手順を運用当番へ引き継ぐ。

## 未完了・外部確認

- cloud Supabase、stagingドメイン、CDN/reverse proxy、Turnstile、SMTP、本番MFA factorはリポジトリへ接続していない
- `RATE_LIMIT_HMAC_SECRET`、正確な `TRUSTED_PROXY_HOPS`、通常/admin DB secret、管理者Auth UUIDは環境ごとに秘密管理して設定する必要がある
- 360/390/768/1440px、TOTP QRの実認証アプリ、dialog focus、キーボード、スクリーンリーダーはstagingと代表端末で最終確認が必要
- 管理当番、問い合わせ先、応答時間、法的エスカレーション、バックアップから復旧した際の再非公開化手順は公開前の運用合意が必要
- cloudの複数instance、実proxy header、DB障害、Auth provider rate limitはローカル再現だけでは本番保証にならない

参照: [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)、[Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)、[Supabase TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp)、[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
