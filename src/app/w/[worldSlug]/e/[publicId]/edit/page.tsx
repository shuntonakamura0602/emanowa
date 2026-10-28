import { notFound } from "next/navigation";

import { OwnerDashboard } from "@/components/ema/owner-dashboard";
import { PageIntro, WorldBreadcrumb } from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { publicIdSchema } from "@/domain";
import { getPublicRuntimeConfig } from "@/server/config";

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
  const { captchaSiteKey, captchaRequired } = getPublicRuntimeConfig();

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="本人編集" />
      <PageIntro eyebrow="本人だけの画面" title="絵馬を管理する">
        <p>
          このURLの絵馬と本人情報が一致した場合だけ、内容の編集・公開範囲の変更・削除ができます。
        </p>
      </PageIntro>
      <OwnerDashboard
        worldSlug={worldSlug}
        expectedPublicId={publicId}
        captchaSiteKey={captchaSiteKey}
        captchaRequired={captchaRequired}
      />
    </section>
  );
}
