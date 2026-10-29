# 段階C — 本人管理・メール引継ぎ設定手順

この文書は、段階Cの作成・編集・削除と、匿名UIDを保ったメール引継ぎをローカルまたはSupabase projectで再現する手順です。メールアドレス、OTP、Cookie、願い本文をログやURLへ記録しません。

## ローカル確認

Docker Desktopを起動し、migrationを最初から適用します。

```bash
pnpm install --frozen-lockfile
pnpm supabase:start
pnpm db:reset
pnpm db:local-role
```

`pnpm db:local-role` が表示したローカル専用URLと、`pnpm exec supabase status --output env` のAPI URL / publishable keyを `.env.local` に設定します。一時パスワードやキーはコミットしません。

```dotenv
EMANOWA_ENVIRONMENT=development
EMANOWA_DATA_MODE=database
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
DATABASE_URL=<pnpm db:local-roleが表示したURL>
RATE_LIMIT_HMAC_SECRET=<ローカル専用の十分に長いランダム値>
```

ローカルAuthは匿名サインインとmanual linkingを有効にしています。確認メールは外部へ送られず、Mailpitの `http://127.0.0.1:54324` で確認できます。`supabase/templates/` のmagic-linkとemail-changeテンプレートは `{{ .Token }}` を表示し、画面から入力するOTP方式に固定しています。

`development` / `test` ではCAPTCHAを必須にせず、site keyが空ならwidgetも表示しません。これにより自動結合試験を外部ネットワークへ依存させません。本番相当の確認はstagingで行い、Turnstile tokenはsessionStorage、URL、HTMLへ保存せず、匿名Authまたは復帰要求の1回だけに使用します。成功・失敗を問わずAuth要求後にwidgetをresetし、期限切れ・再利用済みtokenを送らないでください。

匿名Auth、投稿確定、本人GET・更新・削除、メール追加/復帰要求、OTP検証、ログアウトは同一originのWeb Locksでタブ間直列化します。Web Locksを利用できないブラウザーでは、非原子的な独自leaseへ退避せず認証変更を安全側で拒否します。認証変更中はdurableなpending markerで本人限定内容を一時的に隠し、成功時だけepochをcommit、失敗時はcancelして未保存内容を戻します。タブ中断でpendingが残った場合は、画面の「中断した操作から安全に復旧する」で、破棄確認後に以前の下書きと本人表示を消して続行できます。

対応ブラウザー2タブで、片方の復帰・ログアウト後にもう片方の本人限定表示と下書きが消えること、無効OTPと失敗したログアウトでは下書きが戻ること、応答を保留した投稿・本人更新が認証変更後に画面へ反映されないことをstagingで確認してください。

```bash
pnpm test:stage-c
```

このコマンドはDB reset、全pgTAP、限定role、本人mutation、2つの独立Cookie、メール追加前後の所有権、OTP復帰をローカルサービスで確認します。DBだけを再確認するときは `pnpm test:db` を使います。

## Supabase projectで必要な設定

1. Auth ProvidersでAnonymous Sign-InsとEmailを有効にする。
2. Manual Linkingを有効にする。リンクrouteは現在の匿名セッションにだけ `updateUser({ email })` を実行し、確認前後のUID一致を検証する。
3. Site URLを正規オリジンへ設定し、redirect allow-listも本番・stagingの必要なオリジンだけに限定する。えまのわのOTP routeは任意の外部return URLを受け付けない。
4. Email TemplatesのMagic LinkとChange Emailをコード入力用に変更し、本文へ `{{ .Token }}` を含める。OTPやメールアドレスをURL queryへ入れない。
5. 本番用SMTPを設定し、送信元ドメインのSPF/DKIM/DMARC、bounce、到達性を確認する。既定の試験用送信機構を本番配信に使わない。
6. Auth側のOTP有効期限、コード長、送信間隔、検証回数制限を確認する。アプリ側の共有制限と両方を有効にする。
7. Cloudflare Turnstileで本番・stagingそれぞれのwidgetを作成し、許可hostをその環境の正規hostだけに限定する。site keyを `NEXT_PUBLIC_CAPTCHA_SITE_KEY`、secretをサーバー専用の `CAPTCHA_SECRET_KEY` に設定し、Supabase Dashboardの **Authentication > Bot and Abuse Protection** でもTurnstileと同じsecretを有効にする。匿名作成と別端末からの復帰要求はwidgetのtokenをSupabase Authへ渡す。設定不足・token不足は503/422で閉じ、link済みセッションのOTP検証やログアウトへは新しいchallengeを要求しない。
8. `app_private` をData APIのexposed schemasへ追加せず、通常BFFには `emanowa_app` transaction-pooler接続だけを設定する。

匿名からのメール追加では、確認完了まで「引継ぎ済み」と表示しません。既存アカウントのメールと衝突した場合は自動統合やアカウント切替を行わず、現在の匿名UIDと作品を維持します。別端末の復帰要求は `signInWithOtp` の `shouldCreateUser:false` を使用し、未登録メールにも同じ一般的な202応答を返します。

## cloud適用と確認

```bash
pnpm exec supabase login
pnpm exec supabase link
pnpm exec supabase db push
```

段階Bと同じく、migration適用後に環境専用の `emanowa_app` パスワードを管理接続から設定します。stagingで次を実測してからproductionへ進めます。

- 匿名投稿の前後とメール確認後でUIDが同じ
- 別ブラウザーのOTP復帰後に同じ絵馬を取得できる
- 既存メール競合で所有権・セッションが勝手に切り替わらない
- 無効・期限切れOTP、再送間隔、送信上限が定義済みエラーになる
- Turnstile未完了・期限切れ・再利用済みtokenで匿名作成と復帰要求が拒否され、challenge再実行後だけ成功する
- 2タブで匿名入力とOTP復帰・ログアウトを競合させても、願いが別UIDへ保存されず、古いタブの本人限定内容が消える
- 第三者のPATCH/DELETEが404となり、本人のversion競合が409となる
- owner-only本文が公開API、HTML、RSC、ログ、メールへ含まれない

参照: [Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)、[CAPTCHA Protection](https://supabase.com/docs/guides/auth/auth-captcha)、[Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)、[Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)、[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
