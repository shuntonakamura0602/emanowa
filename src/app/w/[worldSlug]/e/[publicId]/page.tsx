import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmaShape,
  PageIntro,
  StageCard,
  WorldBreadcrumb,
} from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { publicIdSchema } from "@/domain";
import { getPublicEma } from "@/server/ema/repository";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS = {
  family: "家族",
  health: "健康",
  study: "学び・合格",
  work: "仕事",
  love: "恋愛・ご縁",
  challenge: "挑戦",
  other: "その他",
} as const;

export default async function EmaDetailPage({
  params,
}: {
  params: Promise<{ worldSlug: string; publicId: string }>;
}) {
  const { worldSlug, publicId } = await params;
  if (
    !getWorldConfig(worldSlug) ||
    !publicIdSchema.safeParse(publicId).success
  ) {
    notFound();
  }
  const ema = await getPublicEma(worldSlug, publicId);
  if (!ema) notFound();
  const safeWorld = encodeURIComponent(worldSlug);

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬の詳細" />
      <PageIntro eyebrow={worldSlug + "年"} title="絵馬の詳細">
        <p>
          {ema.visibility === "unlisted"
            ? "この絵馬は、リンクを知っている人だけが開けます。リンクは転送されることがあります。"
            : "みんなの願いが集まる、えまのわの絵馬です。"}
        </p>
      </PageIntro>

      <div className="detail-layout">
        <StageCard title={ema.nickname ?? "ななしさん"} tone="warm">
          <EmaShape label={`${ema.nickname ?? "ななしさん"}の絵馬`}>
            <span>
              {ema.messageText === null ? "ひみつの願い" : ema.messageText}
            </span>
          </EmaShape>
          <dl className="detail-list">
            <div>
              <dt>願いの種類</dt>
              <dd>{CATEGORY_LABELS[ema.category]}</dd>
            </div>
            <div>
              <dt>場所</dt>
              <dd>{ema.slotNumber.toLocaleString("ja-JP")}番</dd>
            </div>
          </dl>
        </StageCard>

        <div className="card-grid">
          <StageCard title="できること">
            <p>
              接続後は、地図で見る・共有する・近くに掛ける・通報する導線を、現在の公開設定に合わせて表示します。
            </p>
            <div className="action-row">
              <Link
                className="button button--secondary"
                href={"/w/" + safeWorld}
              >
                この年の地図へ
              </Link>
              <Link className="button button--quiet" href="/me">
                本人管理画面
              </Link>
            </div>
          </StageCard>
          <StageCard title="公開範囲について" tone="private">
            <p>
              {ema.messageVisibility === "owner_only"
                ? "願いの本文は本人だけに保存され、この公開ページには渡していません。表示名・分類・場所は公開情報です。"
                : "この願いの本文と表示名は、現在の公開設定に従って表示されています。"}
            </p>
          </StageCard>
        </div>
      </div>
    </section>
  );
}
