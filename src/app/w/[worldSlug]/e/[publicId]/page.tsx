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
  const safeWorld = encodeURIComponent(worldSlug);
  const safeId = encodeURIComponent(publicId);

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬の詳細" />
      <PageIntro eyebrow={worldSlug + "年"} title="絵馬の詳細">
        <p>
          公開用データの取得はまだ接続していません。URLから本文・所有者・公開状態を推測して表示しません。
        </p>
      </PageIntro>

      <div className="detail-layout">
        <StageCard title="絵馬を読み込む準備中" tone="warm">
          <EmaShape label="絵馬データ未取得のプレースホルダー">
            <span>公開情報を取得後に表示します</span>
          </EmaShape>
          <p className="fine-print">作品ID: {publicId}</p>
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
              <Link
                className="button button--quiet"
                href={"/w/" + safeWorld + "/e/" + safeId + "/edit"}
              >
                本人管理画面
              </Link>
            </div>
          </StageCard>
          <StageCard title="公開範囲について" tone="private">
            <p>
              本文が本人限定なら、公開HTML・画像・メタ情報にも含めません。限定公開の絵馬は、正確なURLを知る人だけが開けます。
            </p>
          </StageCard>
        </div>
      </div>
    </section>
  );
}
