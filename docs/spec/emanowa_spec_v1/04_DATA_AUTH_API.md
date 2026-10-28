# Part 4 — データ・認証・API仕様

版: v1.0 / 仕様基準日: 2026-10-28 / 対象: P0本公開、末尾にP1・P2の拡張境界

本書をAPIパス、DTO、DB不変条件、認証と権限の正本とする。機能範囲はPart 1、画面はPart 2、地図はPart 3、共有体験はPart 5を参照する。ここで決める数値は本プロダクトの初期設定であり、外部サービスの上限や実測値ではない。

## 1. 採用する構成

- Web/BFF: Next.js App Router + TypeScript。ブラウザからデータ操作を行う窓口は同一オリジンの `/api/v1`。
- 認証: Supabase Auth。匿名セッションとメールOTPを利用する。Supabase SSR公式構成を使用し、依存バージョンとlockfileを固定する。[S1][S2]
- DB: Supabase Postgres。原本と補助テーブルは非公開schema `app_private`。このschemaをSupabase Data APIの公開対象に追加しない。
- BFFはサーバー専用の限定DBロールで接続する。通常APIに `postgres`、テーブル所有者、`BYPASSRLS`、`service_role` を使用しない。
- 接続には対応するトランザクションプールを使用する。DB秘密情報はサーバー環境変数のみ。ブラウザにはAuth用publishable keyとURLだけを渡す。
- UI向け型とサーバー入力バリデーションを共通定義し、OpenAPIまたは同等の型付き契約をリポジトリに残す。SQLから生成した行型をそのまま公開DTOにしない。
- P0では `ENABLE_GROUPS=false`、`ENABLE_FULFILLMENT=false`、`ENABLE_PAYMENTS=false`。サーバー設定を正本とし、UIには真偽値のcapabilitiesだけを返す。未開放機能はAPI側でも拒否する。P2導入後のpayments flagは新規販売を止めるもので、既存注文照合・Webhook・返金・購入権利の表示は止めない。

これは新規実装の推奨構成であり、既存リポジトリの技術構成が異なる場合は同じ不変条件を保って置き換えてよい。サービスの新規契約・本番接続・デプロイは、この仕様書の作成だけでは実行しない。

## 2. 不変条件

| 項目         | 契約                                                                  |
| ------------ | --------------------------------------------------------------------- |
| world        | 年別。初回slugは `2027`。slugはimmutable・unique                      |
| サイズ       | 幅1,000 × 高さ1,000。`x,y` は整数0〜999                               |
| 表示番号     | `slotNumber = y * 1000 + x + 1`。1〜1,000,000                         |
| chunk        | 20 × 20。`cx=floor(x/20), cy=floor(y/20)`。各0〜49                    |
| 作品ID       | サーバー生成UUID v4。座標から生成しない。削除後も他作品に再利用しない |
| 正規URL      | `/w/{worldSlug}/e/{publicId}`。URLに所有者UID、秘密、本文を入れない   |
| 所有数       | 1 UIDにつき1 worldにactiveまたはhiddenの絵馬を1枚まで                 |
| 配置         | 1 worldの1座標にactiveまたはhiddenを1枚まで。公開後の移動はP0対象外   |
| 下書き       | ブラウザ内のみ。場所の選択・下書き保存・近隣候補取得では予約しない    |
| 本文         | NFC正規化後、1〜80書記素。plain text。HTML/Markdownとして解釈しない   |
| ニックネーム | 任意、NFC正規化後0〜20書記素。空文字はnull                            |
| 分類         | `family / health / study / work / love / challenge / other`           |
| デザイン     | P0は `basic_wood` のみ。未知IDや未購入IDはサーバーで拒否              |
| 時刻         | DBは `timestamptz` のUTC。表示と運用スケジュールはAsia/Tokyo          |

「1人1枚」は実装上「1 UIDにつき1枚」であり、Cookieを消した人の再匿名登録を厳密に同一人物と判定する保証はしない。IPだけで所有者を識別しない。

入力はサーバーで正規化し、クライアントも同じ処理でプレビューする。改行はLFへ統一し、本文前後の空白を除去。本文は最大4行、nicknameは1行。NUL、不要な制御文字、双方向制御による表示偽装文字を拒否し、絵文字のZWJ・結合文字は保持する。書記素数は `Intl.Segmenter` 相当で数え、`string.length` やDBの文字数だけで代用しない。全リクエストJSONは8KiBまで、本文UTF-8は4KiB、nicknameは1KiBまでの別上限も設ける。URLらしい文字列もリンク化せず通常テキストで表示する。

## 3. 状態と公開範囲

### 3.1 worldと作品の状態

| 状態             | 許可する操作                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| world `preview`  | 公開済み情報の閲覧、ローカル下書き、本人削除、公開範囲の縮小。新規配置・本文編集は禁止 |
| world `open`     | 公開期間内に新規配置、本人編集、削除、公開範囲変更                                     |
| world `archived` | 閲覧、本人削除、公開範囲の縮小のみ。新規・本文編集・グループ参加は禁止                 |
| ema `active`     | 指定された公開範囲で表示。本人が編集可能                                               |
| ema `hidden`     | 管理者非表示。座標と本人枠を保持。公開APIでは存在しない扱い、地図はoccupied            |
| ema `deleted`    | 座標と本人枠を解放。本文・nicknameを消去。復元・ID再利用は禁止                         |

新規配置・本文編集は `state='open' AND opens_at <= DB現在時刻 < closes_at` をトランザクション内で判定する。状態切替ジョブの遅延だけで締切後の投稿を許可しない。公開範囲の縮小は `public→unlisted` と `message_visibility: public→owner_only`。archivedでは逆方向の変更やnickname/design/categoryの変更を許可しない。hiddenは本人削除と公開範囲の縮小のみ可能で、本人編集でactiveへ戻せない。

運営の新規受付停止は `posting_enabled=false` で表す。新規配置にはさらに `posting_enabled=true` が必要。削除・公開範囲の縮小・通報・閲覧をこのフラグで止めない。`acceptingPosts` はDB時刻、state、期間、posting_enabledからサーバーで計算する。受付の一時停止だけでworldをarchivedにしない。

### 3.2 2つの独立した設定

| 設定                 | `public`                               | もう一方の値                                                      |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `visibility`         | 地図・一覧・ランダム訪問から発見できる | `unlisted`: 正確なURLを知る人は閲覧可能。公開一覧には出さない     |
| `message_visibility` | 願い事本文を訪問者と共有画像に表示する | `owner_only`: 本文を本人APIだけで返す。公開表示は「ひみつの願い」 |

nickname、category、design、座標は直接作品URLで表示する公開項目。本文を非公開にしてもnicknameは非公開にならないことを入力画面で説明する。unlistedは認証付きの非公開機能ではない。

unlisted/hiddenの地図データは `{ kind:'occupied', x, y, slotNumber }` のみ。publicId、nickname、category、design、本文、更新日時を載せない。公開詳細、共有画像、HTML、RSC payload、JSON-LD、OGメタデータ、エラーレスポンス、ログにもowner_only本文を混入させない。

## 4. 認証・本人管理

### 4.1 閲覧と匿名投稿

1. 閲覧だけの人には匿名ユーザーを作成しない。public APIはCookie不要で利用できる。
2. 作成画面で入力開始時、必要な場合だけ匿名サインインする。二重タップ・複数タブを含め、既存セッションを確認してから開始する。
3. 匿名AuthにもCAPTCHA/不正利用対策を設定する。匿名Authの利用者はDB上の `authenticated` ロールになり得るため、ロール名だけで所有権を判断しない。[S1]
4. 投稿APIはサーバーで検証済みのUIDを所有者にする。入力JSON内の `owner_id`、`ownerId`、`status`、`publicId`、`version` など未定義キーは422で拒否する。
5. 本人管理画面はセッションCookieから本人APIを呼ぶ。localStorage内のIDや「編集URL」だけでは編集できない。

### 4.2 任意メール登録と復帰

- 投稿後に「この絵馬をあとから管理する」を案内する。登録しなくても公開は完了する。
- **匿名からの登録**: 現在の匿名セッションに `updateUser({email})` でidentityを追加し、メール確認を完了する。同一UIDを保つ。メール確認前を登録完了と表示しない。必要なmanual linking設定は実装時の公式手順に従う。[S1]
- **別端末からの復帰**: 登録済みメールへOTPを送信する。`signInWithOtp` は復帰フローで `shouldCreateUser:false` を指定する。未登録メールでも送信要求のUIは同じ一般的な文言にする。[S3]
- OTPメールはコード入力に対応するテンプレートを設定する。確認はSDKの `verifyOtp` を使用し、メール追加とログインの用途を取り違えない。固定したSDKの公式仕様を確認する。[S4]
- 匿名セッション消失後、メール未登録の作品を公開URLやnicknameだけで本人へ復帰させない。「このブラウザのデータを消すと管理できなくなります」と事前表示する。
- 追加先メールが既存アカウントに属する場合、P0は自動統合しない。`ACCOUNT_LINK_CONFLICT` を表示し、現在の作品を維持する。既存アカウントへ切替する前に未登録作品を管理できなくなる可能性を説明する。
- 所有権の付け替えを任意UIDを受け取るAPIで実装しない。将来の統合は双方のセッション証明と同world重複解消を含む別仕様とする。

### 4.3 検証とセッション分離

通常の本人APIは `getClaims()` 等でJWTを検証し、UIDを取得する。管理操作、メール登録状態が条件となるグループ作成には `getUser()` 等で最新のユーザー状態も確認する。Cookie内のuser JSONや検証していない `getSession()` 結果だけを権限判定に使わない。[S2]

Auth/本人/APIレスポンスは `Cache-Control: private, no-store`。認証に触れるSSR/RSCも共有キャッシュへ入れない。リクエストごとにSSRクライアントを生成し、別ユーザーへ `Set-Cookie` を転用しない。Cookie更新に伴うレスポンスヘッダーを失わない。セッション保存はSDKの公式方式を使い、独自JWTや編集トークンを追加しない。

全変更APIで許可Origin、同一サイトの要求、JSON Content-Typeを確認する。クロスサイトCookie要求を拒否し、必要なCSRF対策を実装する。Authメール送信・認証試行にも独立した制限を適用する。Authorizationヘッダー、Cookie、OTP、メールアドレスをアクセス解析へ送らない。

## 5. DBモデル

P0は実際の作品行だけを挿入する。100万の空枠や100万の空絵馬を事前作成しない。

| テーブル                | 主な列・目的                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds`                | id UUID PK、slug unique、name、state、posting_enabled boolean default true、width=1000、height=1000、opens_at、closes_at、created_at                                                                                      |
| `emas`                  | id bigint内部PK、public_id UUID unique、world_id FK、owner_id UUID、x/y、slot_number生成列、wish_text、nickname、category、design_id、visibility、message_visibility、status、version、created_at、updated_at、deleted_at |
| `ema_public_projection` | ema_id PK/FK、public_id、world_id、x/y、slot_number、公開nickname/category/design、visibility、message_visibility、**公開可能な本文だけ**、version、created_at、updated_at                                                |
| `slot_occupancy`        | world_id、x/y、ema_id unique FK。PK(world_id,x,y)。active/hiddenだけを保持。本文/UID/nicknameなし                                                                                                                         |
| `world_chunks`          | PK(world_id,cx,cy)、occupied_count、active_count、listed_count、revision、updated_at。各countは0〜400                                                                                                                     |
| `idempotency_records`   | owner_id、operation、key_hash、request_hash、result_public_id任意、result_version任意、receipt_json、http_status、created_at。receiptは許可されたID/結果/版だけ。本文を複製しない                                         |
| `reports`               | id UUID、ema_id、reporter_id、reason、detail任意、state=`open\|resolved\|dismissed`、version、created_at、resolved_at。通報者は非公開                                                                                     |
| `admin_users`           | user_id PK、role=`moderator`、enabled、created_at。管理者のサーバー管理台帳                                                                                                                                               |
| `moderation_audit`      | id、admin_id、ema_id、action、reason_code、before_status、after_status、created_at。本文コピーを保存しない                                                                                                                |
| `rate_limit_buckets`    | action、subject_hash、window_start、count、expires_at。共有DBまたは同等の耐久ストアで代替可                                                                                                                               |

`ema_public_projection` はactiveのみ保持し、owner_onlyの本文列は必ずNULL。unlistedの直接詳細に必要な投影は保存できるが、公開一覧のクエリは `visibility='public'` を必須条件にする。原本と公開投影の同期を非同期ジョブへ丸投げしない。

countは `listed_count <= active_count <= occupied_count <= 400`。activeはunlistedを含みhiddenを除く。occupiedはactiveとhidden、listedはactiveかつpublic。「掛かっている絵馬の数」にはactive_countの合計を使う。

owner_idはAuthのUID。Authユーザーの一括削除を作品へ無条件CASCADEしない。匿名Authの整理ジョブは作品・通報・グループを保有しない休眠アカウントだけを対象にする。アカウント削除を実装する場合は、先に本人作品の削除とセッション失効を行う専用手続きを追加する。

### 5.1 必須制約・indexの参考SQL

以下はmigration設計の核であり、schema全体・列型・RLS・権限を省略した参考断片である。そのまま「検証済みmigration」として適用しない。

```sql
alter table app_private.emas
  add constraint emas_xy_check
    check (x between 0 and 999 and y between 0 and 999),
  add constraint emas_version_check check (version >= 1);

create unique index emas_live_slot_uq
  on app_private.emas (world_id, y, x)
  where status in ('active', 'hidden');

create unique index emas_live_owner_uq
  on app_private.emas (world_id, owner_id)
  where status in ('active', 'hidden');

create unique index idempotency_owner_operation_key_uq
  on app_private.idempotency_records (owner_id, operation, key_hash);

create index ema_public_feed_idx
  on app_private.ema_public_projection
  (world_id, created_at desc, public_id desc)
  where visibility = 'public';

create index ema_public_category_feed_idx
  on app_private.ema_public_projection
  (world_id, category, created_at desc, public_id desc)
  where visibility = 'public';
```

加えて、public_id unique、world/ema FK、enum/check、deleted時の本文・nickname NULL、active/hidden時の本文必須、slot_number生成列、world期間の前後関係をDBで制約する。座標検索にはoccupancyのPKとprojectionの `(world_id,y,x)`、本人一覧には `(owner_id,world_id)` を設ける。API最大件数に対してEXPLAINで確認し、不要なindexは追加しない。

## 6. DBアクセス境界とRLS

### 6.1 サーバーからのアクセス

通常DBロールは `emanowa_app` を例とし、`NOSUPERUSER NOBYPASSRLS`、原本の非所有者とする。migration専用ロールと分離する。ブラウザ、公開Supabaseロール `anon/authenticated`、`PUBLIC` へ内部schemaの利用権限・内部関数のEXECUTEを付与しない。[S5]

1. BFFでセッションを検証し、必要な権限を判断する。
2. DB接続を1つ取得し、BEGINする。
3. パラメーター付き `set_config('app.actor_id', verifiedUid, true)` を同じトランザクション内で設定する。公開APIは空値。
4. 内部の `current_actor_id()` は空値ならNULL、正しいUUIDならその値を返す。これはBFFが設定する信頼境界であり、ブラウザ入力をコピーしてはいけない。
5. invoker関数または同一接続のパラメーター付きSQLで処理し、COMMIT/ROLLBACKする。接続返却後にactorが残らないことをテストする。

Supabase Data APIを経由しない直接Postgres接続では `auth.uid()` が自動で埋まると仮定しない。上記のアプリ用コンテキストを利用する。ユーザー指定のSQL、任意schema、任意sort列を実行しない。

### 6.2 権限行列

| データ               | 公開API                         | 本人API                                | 管理API                              |
| -------------------- | ------------------------------- | -------------------------------------- | ------------------------------------ |
| world / 内容なし統計 | 許可されたDTOのみ               | 同左                                   | 設定変更は運用のみ                   |
| ema原本              | 参照不可                        | `owner_id=current_actor_id()` の行のみ | 監査対象のモデレーション処理のみ     |
| 公開投影             | public一覧 / UUID一致の直接詳細 | 公開投影を流用せず本人DTO              | owner_only本文を管理画面へ表示しない |
| occupancy            | 座標の占有情報のみ              | 配置transactionの必要範囲              | hidden/deleteに連動                  |
| reports              | 自分の通報作成のみ              | 他人の通報者情報は不可                 | 管理者のみ一覧・解決                 |
| admin_users / audit  | 不可                            | 不可                                   | 有効な管理者のみ、監査保存           |
| idempotency          | 不可                            | 自分のoperation/keyのみ                | 障害調査は必要最小限                 |

原本はRLSを有効にし、SELECT/INSERT/UPDATEの所有権条件を設定する。UPDATEはSELECTポリシーとUSING/WITH CHECKの両方が必要。owner_id/world_id/public_id/x/yを一般編集で変更できない列権限・関数境界を設ける。[S5]

公開projectionの列には秘密情報を入れない。通常一覧とUUIDによる詳細を別query関数に分ける。さらにRLSでpublicのみ許可し、直接詳細の場合だけBFFがtransaction-localに指定したlookup UUID一致を許可する。クエリ引数だけで任意ユーザー・任意非公開一覧を解禁しない。occupancyの内部ema_idはDTOへ投影しない。

配置・更新は原則 `SECURITY INVOKER`。補助テーブルにも実際の処理に必要なRLSとgrantだけを付ける。特権関数が不可避なら内部schemaに限定し、固定search_path、テーブルの完全修飾、PUBLIC/anon/authenticatedからEXECUTE revoke、専用ロールへの最小grant、本文中の検証済みactor UID確認を必須にする。管理関数はさらにadmin_usersの現在値を確認する。所有者権限のviewやdefinerでRLSを無自覚に迂回しない。[S5]

管理者判定はサーバー管理のadmin_usersを毎回確認する。利用者が編集できる `user_metadata`、nickname、メールの文字列一致だけから管理者権限を付与しない。管理者は確認済みメールとMFAを必須とし、通常投稿用DB接続へ管理権限を持たせない。

管理APIでは検証済みJWTの認証保証レベルがMFA完了相当であることも確認する。管理画面の表示可否とAPIの権限判定を分け、API側を省略しない。

## 7. DTOの正本

JSONはcamelCase、DBはsnake_case。全日時はUTCのISO 8601文字列。内部ID、owner UID、メール、IP、管理理由の自由記述は公開DTOに含めない。publicIdはUUID文字列。

```ts
type Category =
  "family" | "health" | "study" | "work" | "love" | "challenge" | "other";
type Visibility = "public" | "unlisted";
type MessageVisibility = "public" | "owner_only";
type PublicEma = {
  publicId: string;
  worldSlug: string;
  x: number;
  y: number;
  slotNumber: number;
  nickname: string | null;
  category: Category;
  designId: "basic_wood";
  visibility: Visibility;
  messageVisibility: MessageVisibility;
  messageText: string | null; // owner_onlyは必ずnull
  version: number;
  createdAt: string;
  updatedAt: string;
};
type ChunkCell =
  | { kind: "public"; ema: PublicEma }
  | { kind: "occupied"; x: number; y: number; slotNumber: number };
type ChunkResponse = {
  worldSlug: string;
  cx: number;
  cy: number;
  revision: number;
  cells: ChunkCell[]; // 0〜400件。存在しない座標はempty
};
type OwnerEma = {
  publicId: string;
  worldSlug: string;
  x: number;
  y: number;
  slotNumber: number;
  nickname: string | null;
  category: Category;
  designId: "basic_wood";
  visibility: Visibility;
  messageVisibility: MessageVisibility;
  wishText: string;
  status: "active" | "hidden";
  version: number;
  createdAt: string;
  updatedAt: string;
  capabilities: {
    editContent: boolean;
    visibilityMode: "all" | "restrict_only" | "none";
    delete: boolean;
  };
};
type MutationReceipt = {
  publicId: string;
  worldSlug: string;
  version: number;
  result: "created" | "updated" | "deleted";
  canonicalUrl: string;
};
type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Record<string, string>;
    retryAfterSeconds?: number;
  };
};
```

公開本文nullの表示文言はUIが生成する。`messageText` に本当の秘密本文を渡してCSSで隠す実装は禁止。OwnerEmaは独立schemaとし、PublicEmaの型キャストだけで出力しない。mutationはreceiptだけを返し、本人画面は必要に応じてOwnerEmaを再取得する。

## 8. P0 API一覧

`{slug}` はworldSlug、`{id}` はpublicId。成功レスポンスは下表の形を固定する。JSON成功時は `Content-Type: application/json`、画像のみPNG。全変更APIは同一オリジン限定。`owner` は検証済み匿名/登録ユーザー、`admin` は追加の管理者認証を表す。

| Method / path                                      | 認証  | 入出力・制約                                                                                                                                                                                                        |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/worlds/{slug}`                               | 不要  | `{world:{slug,name,state,width,height,opensAt,closesAt,acceptingPosts},serverTime,stats:{occupiedCount,activeCount,listedCount,asOf},capabilities:{groups,fulfillment,payments}}`。serverTimeはDB現在時刻、no-store |
| GET `/worlds/{slug}/overview?cellSize=20`          | 不要  | `{cellSize,cells:[{x,y,occupiedCount,activeCount,listedCount}],asOf}`。cellSizeは20（既定）または100。各cell左上座標、最大2,500または100集計。本文/IDなし                                                           |
| GET `/worlds/{slug}/chunks?cx=&cy=`                | 不要  | `ChunkResponse`。整数0〜49。1要求につき1chunk                                                                                                                                                                       |
| GET `/worlds/{slug}/emas?limit=&cursor=&category=` | 不要  | `{items:PublicEma[],nextCursor:string\|null}`。public/activeのみ。limit既定24、最大50                                                                                                                               |
| GET `/worlds/{slug}/emas/random?category=`         | 不要  | `{item:PublicEma\|null}`。public/activeのみ。大量OFFSETや全件ブラウザ取得は禁止                                                                                                                                     |
| GET `/worlds/{slug}/emas/{id}`                     | 不要  | `{ema:PublicEma}`。unlistedは正しいIDなら可。hidden/deleted/別worldは404                                                                                                                                            |
| GET `/worlds/{slug}/nearby?near={id}`              | 不要  | `{origin:{x,y},candidates:[{x,y,slotNumber}],searchedRadius}`。最大8候補。searchedRadiusは3/8/20                                                                                                                    |
| GET `/worlds/{slug}/nearby?x=&y=`                  | 不要  | 同上。nearとx/yの同時指定は400。座標は0〜999                                                                                                                                                                        |
| POST `/worlds/{slug}/emas`                         | owner | `CreateEmaInput`。`Idempotency-Key`必須。201 `{receipt:MutationReceipt}`                                                                                                                                            |
| GET `/me/emas?world={slug}`                        | owner | `{ema:OwnerEma\|null}`。hiddenも本人へ返す。deletedはnull                                                                                                                                                           |
| GET `/me/worlds?limit=&cursor=`                    | owner | `{items:OwnerWorldSummary[],nextCursor}`。自分のactive/hidden絵馬がある年を新しい順に返す。limit既定12、最大50                                                                                                      |
| PATCH `/me/emas/{id}`                              | owner | `UpdateEmaInput`。200 `{receipt}`。所有権とversionを検証                                                                                                                                                            |
| DELETE `/me/emas/{id}`                             | owner | JSON `{expectedVersion}`。200 `{receipt}`。本文抹消・枠解放                                                                                                                                                         |
| POST `/worlds/{slug}/emas/{id}/reports`            | owner | `{reason,detail?}`。201 `{reportId,accepted:true}`。本人が未登録でも通報可。同一UIDの同作品へのopen通報があれば200で既存reportId                                                                                    |
| GET `/worlds/{slug}/emas/{id}/image?variant=og`    | 不要  | 1200×630 PNG。公開投影から生成。variantは `og` または `square`（1080×1080）                                                                                                                                         |
| GET `/admin/reports?cursor=&state=`                | admin | 通報キュー。最大50。対象の公開投影、reason、detail、stateを返す                                                                                                                                                     |
| POST `/admin/emas/{id}/moderation`                 | admin | `{action:'hide'\|'restore'\|'delete',reasonCode,expectedVersion}`。監査記録必須                                                                                                                                     |
| PATCH `/admin/reports/{reportId}`                  | admin | `{state:'resolved'\|'dismissed',expectedVersion}`。200 `{reportId,state,version}`。作品状態の変更とは別操作                                                                                                         |

表中のパスはすべて `/api/v1` が先頭。UIの正規作品URLは `/w/{slug}/e/{id}`。画像routeをフレームワークのOG routeへ委譲しても、このAPI契約は維持する。

```ts
type CreateEmaInput = {
  x: number;
  y: number;
  wishText: string;
  nickname?: string | null;
  category: Category;
  designId: "basic_wood";
  visibility: Visibility;
  messageVisibility: MessageVisibility;
};
type UpdateEmaInput = {
  expectedVersion: number;
  wishText?: string;
  nickname?: string | null;
  category?: Category;
  designId?: "basic_wood";
  visibility?: Visibility;
  messageVisibility?: MessageVisibility;
};
type OwnerWorldSummary = {
  worldSlug: string;
  worldName: string;
  worldState: "preview" | "open" | "archived";
  ema: {
    publicId: string;
    slotNumber: number;
    status: "active" | "hidden";
    designId: string;
    visibility: Visibility;
    messageVisibility: MessageVisibility;
    version: number;
    updatedAt: string;
  };
};
```

PATCHは指定フィールドだけを更新する。省略とnullを区別し、nicknameだけnullで消去可能。空PATCH、未知キー、座標/owner/statusの変更を422にする。変更値が同一でも成功時にversionを1増加させる。DELETE/PATCH/通報/管理変更にもIdempotency-Keyを必須にする。

通報reasonと管理reasonCodeは `spam / harassment / personal_information / sexual_content / illegal_content / other` の列挙値。通報detailは任意200書記素、UTF-8 2KiB以内のplain text。`(reporter_id,ema_id) WHERE state='open'` をuniqueにし、同じ人の連投でキューを増やさない。通報は非表示の投票ではなく、件数だけで自動hiddenにしない。

日本語ラベルは順に「宣伝・スパム」「嫌がらせ」「個人情報」「性的な内容」「違法行為に関する内容」「その他」。`/me` の年別一覧は `/me/worlds` を使い、年を開いたときだけ `/me/emas?world=` で本人の本文を取得する。年別一覧のcursorも検証し、他人のUIDをqueryに受け付けない。

### 8.1 認証用BFF route

| POST path                    | 契約                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/auth/anonymous`     | `{captchaToken}`。有効な既存セッションがあれば再利用。新規時のみ匿名Authを作成。Cookieを設定し `{authenticated:true,isAnonymous:boolean}`。既存登録済みユーザーを匿名へ戻さない |
| `/api/v1/auth/email/link`    | 現在の匿名セッション必須。`{email}`。同一UIDへのメール追加要求。202 `{accepted:true}`                                                                                           |
| `/api/v1/auth/email/recover` | `{email,captchaToken?}`。既存アカウントへのOTP送信。202 `{accepted:true}`                                                                                                       |
| `/api/v1/auth/email/verify`  | `{flow:'link'\|'recover',email,token}`。linkは元UIDをセッション側で保持・検証。成功時Cookie更新。200 `{authenticated:true,isAnonymous:false}`                                   |
| `/api/v1/auth/signout`       | 現セッションの終了。200 `{signedOut:true}`。未登録作品が残る場合はUIで事前確認                                                                                                  |

SDKをブラウザから呼ぶ部分が必要なら、routeの実装を薄いadapterに置き換えてよい。ただし同じ認証・制限・同一UID・Cookie分離の契約を保つ。メール/OTPを任意URLクエリや計測イベントへ入れない。任意の外部return URLを受け付けない。

### 8.2 ページング・近隣検索

一覧は `(created_at DESC, public_id DESC)` のkeyset pagination。cursorにworld/category/orderを含め署名または厳密検証し、不正なcursorは400。ページ間の新規投稿により表示が変わることは許容するが、クライアントはpublicIdで重複除去する。

nearbyは参照作品のworldとactive状態を確認する。unlistedは直接IDを知る人の招待に使用可。hidden/deletedは404。原点からChebyshev距離3、8、20の順に探索を広げ、距離の二乗 `dx*dx+dy*dy`、slotNumberの順で最大8件。8件得られた段階か半径20で打ち切り、実際の探索半径を返す。最大41×41の範囲に限定し、見つからなければ空配列を返して別の場所へ案内する。候補は予約ではなく、確定時に再検証する。

UIの作成URLにnearと座標が混在した場合はnearを優先し、APIにはどちらか一方だけ渡す。近隣リンクから他人の公開範囲や所有権は変化しない。

## 9. トランザクションと競合

### 9.1 新規配置

1. リクエストサイズ、Origin、認証、入力、制限を検証する。入力を正規化してrequest_hashを作る。
2. BEGIN後、検証済みactorをtransaction-localに設定する。冪等性キー単位のロックまたはunique行で直列化する。
3. 既存の成功記録があればhashを比較し、同じなら保存したreceiptを返す。違えば409。
4. world状態・投稿期間・posting_enabledと所有数をDBで再検証する。所有数の最終保証はpartial unique indexとする。
5. emas、occupancy、公開projectionを挿入する。public_idはここで生成する。座標/所有数のunique違反を対応する409へ変換する。
6. 対象chunkのcount/revisionと、必要な耐久制限・冪等性成功記録を更新する。
7. すべてを同一transactionでCOMMITしてから201を返す。一部だけ成功したレスポンスを返さない。

公開projectionへはmessage_visibilityがpublicの場合だけ本文をコピーする。クォータ、原本、占有、投影、chunk count、成功記録の更新を別HTTPリクエストへ分割しない。率制限を外部ストアで先に消費する場合は、失敗時に試行回数が残ることを許容し、所有数の正確性をそのストアへ依存させない。

競合時、選択位置を勝手に変更して投稿しない。UIは本文/設定を保持し、近隣候補を再取得する。同じ人の同時投稿が別座標に到達した場合も1枚のみ成功させる。

### 9.2 編集・削除・管理非表示

- 行をロックして本人/管理者権限、state、`expectedVersion === version` を確認する。不一致は409 `VERSION_CONFLICT`。新しい本文で上書きしない。
- 成功時にversionを1増加し、投影とchunk revision/countを同一transactionで更新する。
- hidden化: projectionを削除、occupancyは維持、active_countを減らし、元がpublicならlisted_countも減らす。本人の1枚枠は保持する。
- restore: activeへ戻し、現在の公開設定からprojectionを作り直す。deletedからrestoreは禁止。
- delete: 原本をdeletedへ変更しwish_text/nicknameをNULL、projectionとoccupancyを削除、chunk countを減らす。監査・冪等性に本文を残さない。
- countの差分は変更前後の状態から算出する。hiddenのdeleteでactiveを二重に減らさず、public→unlistedではlistedだけを減らす。
- 削除後の公開URLは404。新しい作品が同じ座標に入っても古いIDから転送しない。本人の同じdelete再送は同じreceiptを返す。
- 画像生成は公開投影を読み、そのversionの画像を生成後、返却直前に現在version/公開状態を再確認する。途中で縮小/削除された場合は破棄して再取得または404にする。

### 9.3 冪等性の詳細

`Idempotency-Key` はクライアントが操作開始時に生成するUUID v4。送信が不明な場合の再試行は同じkeyと同じbodyを使う。本文や座標を変えてやり直す場合は新しいkeyにする。

unique範囲は `(owner_id, operation, key_hash)`。operationにはHTTP操作と対象worldまたはpublicIdを含める。正規化したbodyと対象pathのcanonical JSONをSHA-256等でhash化する。同じkeyの同時要求は1つだけが実行され、他方は完了を待つか503で再試行を案内する。

成功receiptは不変で本文を含まない。作成後に削除しても同じcreate再送で作品を復活させない。再送receiptのversionはその操作が成功した時点の値であり、現在状態は本人GETで確認する。失敗したtransactionの成功記録は残さない。成功keyの最低限の記録はworldと作品tombstoneの存続中保持し、24時間等で削除して再作成を許してはいけない。

## 10. キャッシュ・公開取り消し・負荷

- P0の個別作品、一覧、chunk、OG/PNGは `Cache-Control: no-store`。Next.jsのデータキャッシュや画像CDNへ私的本文を保存しない。公開一覧の速さはindex・件数上限で確保する。
- 内容を含まないoverviewと統計だけ最大30秒の共有キャッシュを許可する。asOfを返す。countの遅延を空枠の確定判断に使わない。
- clientの公開データはページ表示中だけ保持し、mutation後は対象chunk/作品を無効化する。再訪・タブ復帰時は再取得する。offlineキャッシュにUGC本文を入れない。
- 公開から非公開へ変えた後に、既存SNSの画像キャッシュ・他人が保存済みの画像まで回収できるとは表示しない。以後の自サーバー応答は現在設定へ即時追従させる。
- 後でCDNを導入する場合は、非公開化時の同期purge・cache key・失効失敗時の安全な応答を追加設計してから有効化する。
- 100万件のSELECT、巨大OFFSET、全件DOM化、全件Realtime購読を禁止する。地図は可視chunkと小さな先読みだけ取得する。
- chunkは最大400件で固定schema。非圧縮512KiBを通常応答の目標、4MiBを初期保護上限とする。文字列のバイト上限も適用する。超過時に一部の占有枠を黙って省略せず503で粗い表示へ戻し、取得失敗を空枠扱いしない。
- ランダム訪問は公開候補のbucket/keyset等で上限付き探索を行い、全件 `ORDER BY random()` を常用しない。対象なしは200 item:null。

## 11. エラーと初期レート制限

| HTTP / code                             | UIの扱い                                                          |
| --------------------------------------- | ----------------------------------------------------------------- |
| 400 `INVALID_QUERY` / `INVALID_CURSOR`  | URLやページング条件を修正する                                     |
| 400 `INVALID_OTP`                       | コードまたは期限を確認し、必要なら再送する。本文下書きは保持      |
| 401 `AUTH_REQUIRED` / `SESSION_EXPIRED` | 下書きを保持し、再認証する                                        |
| 403 `FORBIDDEN` / `ADMIN_REQUIRED`      | 操作不可。権限情報や他人のIDを追加表示しない                      |
| 404 `NOT_FOUND`                         | 未存在・hidden・deleted・別world・他人の本人routeを同じ扱いにする |
| 409 `SLOT_TAKEN`                        | 下書きを保持し、近隣候補を選び直す                                |
| 409 `OWNER_LIMIT_REACHED`               | 本人の既存絵馬へ誘導する                                          |
| 409 `VERSION_CONFLICT`                  | 編集内容を保持し、現在データを取得して再確認する                  |
| 409 `IDEMPOTENCY_KEY_REUSED`            | 同じkeyの別body。クライアント処理を修正する                       |
| 409 `WORLD_NOT_OPEN`                    | 期間/状態に応じて閲覧へ戻す。書き込み自動再送を続けない           |
| 409 `POSTING_PAUSED`                    | 新規受付の一時停止。下書きを保持し、閲覧は継続できる              |
| 409 `ACCOUNT_LINK_CONFLICT`             | 同一UIDのメール追加を継続できない。勝手にアカウント切替しない     |
| 422 `VALIDATION_ERROR`                  | fieldErrorsを表示。入力を消さない                                 |
| 429 `RATE_LIMITED`                      | Retry-AfterとretryAfterSecondsを返し、待機後に本人が再試行        |
| 503 `TEMPORARILY_UNAVAILABLE`           | 通信復旧後に同じ冪等性keyで再試行。下書きを維持                   |

500系レスポンスにSQL、stack trace、メール、本文、秘密を含めない。requestIdでサーバーログと照合する。DBの制約名は許可リストでアプリerrorへ変換する。

初期のアプリ側制限は配置試行10回/分/UID、編集30回/10分/UID、通報5回/時/UID、画像生成30回/分/送信元、OTP要求は同一宛先60秒間隔を基本とする。Auth側上限は導入時の設定値も確認し、サービス側と両方を適用する。これは推奨初期値で、アクセス実績に応じて変更可能な設定とする。

分散実行に対応したDB/Redis等の共有ストアを使い、プロセス内Mapを本番制限にしない。IPは逆プロキシの信頼できる転送情報から取り、必要なら短期HMAC識別子を使う。共同利用回線のため、IPだけを本人クォータへ使わない。CAPTCHA/制限ストアが利用不能な本番変更要求は503で閉じる。デモ用in-memory adapterは明示的なdemo環境だけで動かし、本番設定不足を黙って代替しない。

## 12. P1/P2の拡張境界

### P1: 無料共同エリア

- `groups`: id UUID v4（公開IDとして利用）、world_id、host_id、name（30書記素）、description（任意120書記素）、origin_x/origin_y、width=10/height=10、state=`open|closed|hidden|deleted`、created_at、updated_at、deleted_at、version。
- 正規URLは `/w/{worldSlug}/g/{groupPublicId}`。作成導線は `/w/{worldSlug}/new?group={groupPublicId}`。矩形はworld境界内に収め、origin_x/origin_yは0〜990。
- エリアはworld内の10×10の矩形。重複可・非排他的。枠の予約権、他人を追い出す権利、場所の販売権を付与しない。
- `group_memberships`: id UUID v4（membershipId。作品publicIdとは別の不透明ID）、group_id、ema_id、owner_id、state=`active|left|removed`、joined_at、version。activeに限りema_id uniqueで「1絵馬1group」。`(group_id,owner_id)` もuniqueにする。
- 参加は本人の明示操作。同worldで範囲内の本人絵馬だけ参加可。範囲外なら参加不可。座標移動や2枚目の作成で回避しない。
- 作成者は毎回確認済みメールの状態を検証。一般参加者は匿名可。group作成は1主催者・1worldにつきdeleted以外を1つまでとするpartial unique indexで制約する。
- 主催者は名称・募集状態・membershipの一覧除外だけ管理。他人の本文編集/削除、owner_only本文の閲覧、世界全体からの撤去はできない。
- 公開グループ一覧はpublic/active作品だけを返す。unlistedを所属一覧や参加履歴から列挙しない。主催者の除外後も元作品は存続する。
- world archivedでは新規group・参加・再参加・名称/説明変更を禁止。退出・募集締切・主催者による一覧除外・group削除は可能。
- closedは募集停止であり既存の公開一覧は存続。hiddenは運営の非表示で公開GETを404。deletedは解散で公開GETを404、名称/説明を消去し、所属だけを解除する。どの場合も主催者操作で元の絵馬を削除しない。
- hiddenのgroupを主催者がopen/closedへ変更して公開復帰させることはできない。主催者には削除だけを許可する。
- 主催者にremovedされた同UIDは同groupへ再参加不可。本人のleftはopen期間中なら再参加可。削除再作成した絵馬でも同UIDのremovedを回避しない。

P1の新規配置でgroupへ同時参加する場合は `groupId` をCreate入力へ追加し、同じDBtransactionでworld・group状態・座標範囲・本人所有を検証する。URLのgroupIdだけで所属を確定しない。P0ではこのキーを受け付けない。

P1のnearbyは任意のgroupを受け付け、候補をその矩形内に制限する。near対象がgroup範囲内ならその周辺、範囲外ならgroup中心を原点にする。グループが空き枠を事前に占有する処理は追加しない。

### P1の追加API契約

以下はP1を実装する際の最小契約。prefixは `/api/v1`。変更APIはIdempotency-Key必須、本人/主催者の検証、Origin確認、同一transaction、409競合、no-storeをP0と同様に適用する。未開放時は404 `FEATURE_NOT_ENABLED`。

```ts
type PublicGroup = {
  publicId: string;
  worldSlug: string;
  name: string;
  description: string | null;
  originX: number;
  originY: number;
  width: 10;
  height: 10;
  state: "open" | "closed";
  version: number;
  memberCount: number;
  listedMemberCount: number;
  createdAt: string;
  updatedAt: string;
};
type GroupReceipt = {
  groupPublicId: string;
  version: number;
  result: "created" | "updated" | "deleted";
};
type MembershipReceipt = {
  groupPublicId: string;
  membershipId: string;
  state: "active" | "left" | "removed";
  membershipVersion: number;
};
type OwnerGroup = Omit<PublicGroup, "state"> & {
  state: "open" | "closed" | "hidden";
};
type HostMembership =
  | { kind: "listed"; membershipId: string; version: number; ema: PublicEma }
  | { kind: "unavailable"; membershipId: string; version: number };
type Fulfillment = {
  state: "pending" | "fulfilled";
  fulfilledAt: string | null;
};
```

PublicGroupにhost UID/メールは含めない。memberCountはactive所属かつactive絵馬（unlisted含む）、listedMemberCountはさらにpublicの件数。両者の違いから非公開IDを列挙するAPIは作らない。

| Method / path                                         | 入力・結果・権限                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/worlds/{slug}/groups`                          | 確認済みメールの主催者。`{name,description?,originX,originY}`。world open。201 `{receipt:GroupReceipt}`                                      |
| GET `/groups/{groupId}`                               | 認証不要。200 `{group:PublicGroup}`。closedも閲覧可。hidden/deletedは404                                                                     |
| GET `/groups/{groupId}/members?limit=&cursor=`        | 認証不要。`{items:PublicEma[],nextCursor}`。既定24/最大50、joinedAtとema publicIdのkeyset。public/active所属のみ                             |
| GET `/me/groups?world={slug}`                         | 本人。主催するdeleted以外のgroupまたはnull。`{group:OwnerGroup\|null,capabilities:{editMetadata,close,delete,removeMembers}}`                |
| GET `/me/groups/{groupId}/memberships?cursor=`        | 主催者のみ。`{items:HostMembership[],nextCursor}`、最大50。unlisted/hiddenはunavailable。作品ID/URL/座標/名前/本文なし                       |
| PATCH `/groups/{groupId}`                             | 主催者のみ。`{expectedVersion,name?,description?,state?:'open'\|'closed'}`。座標変更不可。200 `{receipt:GroupReceipt}`                       |
| DELETE `/groups/{groupId}`                            | 主催者のみ。`{expectedVersion}`。groupをdeletedにし、active所属をremovedへ変更。絵馬は保持。200 `{receipt:GroupReceipt}`                     |
| POST `/groups/{groupId}/join`                         | 本人。`{emaPublicId,expectedVersion}` のversionは本人絵馬。world/group open、active本人絵馬、範囲内を検証。200 `{receipt:MembershipReceipt}` |
| DELETE `/groups/{groupId}/membership`                 | 本人。`{expectedMembershipVersion}`。自分のactive所属をleftへ。200 `{receipt:MembershipReceipt}`。archivedでも可能                           |
| DELETE `/groups/{groupId}/memberships/{membershipId}` | 主催者のみ。`{expectedMembershipVersion}`。そのgroupの所属だけをremovedへ。200 `{receipt:MembershipReceipt}`。作品publicIdは返さない         |
| GET `/groups/{groupId}/image?variant=og`              | 公開groupのカードPNG。og/squareはP0と同じ寸法。名称・年度・参加数・匿名モチーフのみ。作品本文/nicknameは含めない                             |
| POST `/admin/groups/{groupId}/moderation`             | 管理者。`{action:'hide'\|'restore'\|'delete',reasonCode,expectedVersion}`。restoreはclosedへ。監査を保存し200 `{receipt:GroupReceipt}`       |
| PATCH `/me/emas/{id}/fulfillment`                     | 本人。`{state:'pending'\|'fulfilled',expectedVersion}`。world open・active絵馬のみ。200 `{receipt:MutationReceipt}`                          |

P1のOwnerEmaに `groupMembership:{groupPublicId,membershipId,version}|null` と `fulfillment:Fulfillment` を追加する。groupMembershipは現在のactive所属だけ。PublicEmaには `fulfillment:Fulfillment` を追加し、本文の秘密設定は引き続き厳守する。成就日時はサーバー現在時刻、pendingへ戻すとnull。成就変更は原本versionと投影を同じtransactionで更新する。

参加時はworld→group→ema→membershipの順など固定したロック順を使用する。別groupへの同時joinはactive unique制約で1つだけ成功させる。同groupに既にactiveなら既存receiptを返し、人数を二重加算しない。グループ削除とjoinが競合しても削除済みgroupのactive所属を作らない。絵馬delete時は所属と成就情報も同じtransactionで無効化/削除する。

別groupへの移動は本人が旧所属をleftにしてから新しいgroupへjoinする。自動移動やatomicな所属差し替えはP1に実装しない。後のjoinが失敗しても旧所属へ勝手に戻さない。

P1でmoderation_auditを `subject_type + subject_id` へ拡張し、groupの管理操作も記録する。group非表示は絵馬の非表示と分け、所属する他人の作品を一括hiddenにしない。

追加エラーは403 `VERIFIED_EMAIL_REQUIRED`、403 `GROUP_MEMBERSHIP_REMOVED`、409 `GROUP_OWNER_LIMIT_REACHED`、409 `GROUP_CLOSED`、409 `OUTSIDE_GROUP`、409 `ALREADY_IN_GROUP`、409 `EMA_NOT_ACTIVE`。versionの不一致は既存 `VERSION_CONFLICT`。権限のない主催者操作はFORBIDDEN、見えないgroup/所属はNOT_FOUND。座標外へ新しい作品を自動配置して解消しない。

### P1: 成就状態 / P2: 決済

成就は `fulfillments` を別テーブルで追加し、ema_id、状態、timestampのみ保持する。元の願い事・公開設定・作品IDを保持し、追記本文・写真はP1にも含めない。本人のみopen期間中に変更可能で、archivedでは変更不可。unlisted/owner_onlyの公開規則を引き継ぐ。P0では未完成列・UIを開放しない。

P2はorders/payments/entitlementsを追加し、商品カタログをサーバーで管理する。価格・design権限をクライアント入力から信用しない。購入完了画面への遷移だけでは権利を付与せず、検証済みWebhookと一意なイベントIDで付与する。購入・返金・退会時の表示はP2の別受入条件とする。

装飾権利はowner+world+designに紐づけ、同じ年に削除して作り直しても利用できる。主催者プランはgroup+worldに紐づき、枠の独占権には変えない。価格・販売期間・返金条件は本公開前に確定する初期案として扱う。

## 13. 実装完了の受入条件

- 同座標へ異なる100リクエストを同時送信して成功が1件。敗者の本文は残り、counter/occupancy/projectionに孤児がない。
- 同UIDが別座標へ同時配置して成功が1件。hiddenでも2枚目を作れず、delete後は新規IDで配置可能。
- 同じkey/bodyの同時再送は同じreceipt。別bodyは409。応答喪失後の再送と削除後の旧create再送でも二重作成しない。
- 他人のUUID/ownerId偽装、未検証Cookie、未公開schema/Data API直アクセス、公開関数へのEXECUTEで本人操作を突破できない。
- owner_onlyの固有テスト文言が公開API/HTML/RSC/OG/PNG/chunk/一覧/エラー/ログへ含まれない。本人GETでは正しく読める。
- unlistedのpublicId/nickname/本文が地図・一覧・random・group一覧へ出ず、直接URLだけは設定通り表示される。
- UID A/Bの要求を同じ接続プールで交互実行し、SQL context・SSR・Cookie・キャッシュが混線しない。
- 本文編集中に別端末から更新/削除して、古いexpectedVersionで上書きできない。公開範囲縮小後の新規取得に旧本文がない。
- メール追加前後でUIDと所有作品が同じ。別端末OTP復帰、OTP失敗、既存メール競合、匿名セッション消失が定義通り動く。
- JST締切の直前/直後、world archived、制限ストア停止、DB接続切断で不変条件を保つ。
- DB制約・RLS・migrationをローカルまたは隔離テストDBで検証し、lint/typecheck/必要な統合・E2E検証結果を残す。本書作成時点ではアプリとSQLを実行検証したとは扱わない。

## 14. 実装時に参照する一次資料

以下は2026-10-28に確認した認証・権限の参照先。上記のAPI名、文字数、枠数、制限値はえまのわ独自の設計である。実装時はchangelogと採用SDK版の仕様を再確認する。

- [S1: Supabase — Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [S2: Supabase — Creating a client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [S3: Supabase — Passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [S4: Supabase JavaScript — verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [S5: Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Changelog](https://supabase.com/changelog)
