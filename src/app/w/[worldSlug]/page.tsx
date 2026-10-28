import { notFound } from "next/navigation";

import { PageIntro, WorldBreadcrumb } from "@/components/site-shell";
import { WorldExplorer } from "@/components/world/world-explorer";
import { getWorldConfig } from "@/config/worlds";

export default async function WorldPage({
  params,
}: {
  params: Promise<{ worldSlug: string }>;
}) {
  const { worldSlug } = await params;
  if (!getWorldConfig(worldSlug)) {
    notFound();
  }
  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬を眺める" />
      <PageIntro eyebrow={worldSlug + "年"} title="みんなの願いを眺める">
        <p>
          地図と一覧は同じ公開情報を使います。本文を自分だけにした願いは、公開画面へ渡しません。
        </p>
      </PageIntro>

      <WorldExplorer worldSlug={worldSlug} />
    </section>
  );
}
