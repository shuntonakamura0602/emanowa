import { notFound } from "next/navigation";

import { PageIntro, StageCard, WorldBreadcrumb } from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { publicIdSchema } from "@/domain";

export default async function EditEmaPage({
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

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="本人編集" />
      <PageIntro eyebrow="本人だけの画面" title="絵馬を管理する">
        <p>
          セッションによる本人確認と本人用DTOは段階B以降で接続します。公開URLを知っているだけでは編集できません。
        </p>
      </PageIntro>

      <div className="card-grid">
        <StageCard title="本人確認が必要です" tone="private">
          <p>
            現在は認証処理が未接続のため、本文の取得・編集・削除を行いません。別の利用者の情報を仮表示することもありません。
          </p>
          <button className="button" type="button" disabled>
            編集を始める
          </button>
        </StageCard>
        <StageCard title="接続後にできること">
          <dl className="definition-list">
            <div>
              <dt>内容の編集</dt>
              <dd>願い、表示名、種類、公開範囲を版番号つきで更新します。</dd>
            </div>
            <div>
              <dt>公開範囲を狭める</dt>
              <dd>受付終了後も、公開から限定・本文非公開へ変更できます。</dd>
            </div>
            <div>
              <dt>削除</dt>
              <dd>本人確認後に原文を消去し、旧URLを別作品へ流用しません。</dd>
            </div>
          </dl>
        </StageCard>
      </div>
    </section>
  );
}
