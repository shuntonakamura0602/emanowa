import { notFound } from "next/navigation";

import { NewEmaFlow } from "@/components/ema/new-ema-flow";
import { PageIntro, WorldBreadcrumb } from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { toSlotNumber } from "@/domain/coordinates";
import { getPublicRuntimeConfig } from "@/server/config";

export default async function NewEmaPage({
  params,
  searchParams,
}: {
  params: Promise<{ worldSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { worldSlug } = await params;
  if (!getWorldConfig(worldSlug)) {
    notFound();
  }
  const query = await searchParams;
  const initialSlotNumber = slotNumberFromQuery(query.x, query.y);
  const { captchaSiteKey, captchaRequired } = getPublicRuntimeConfig();

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬を書く" />
      <PageIntro eyebrow="新しい絵馬" title="願いを書く">
        <p>
          願いと公開範囲、掛ける場所を選び、公開時の見え方を確認してから保存します。
        </p>
      </PageIntro>
      <NewEmaFlow
        worldSlug={worldSlug}
        captchaSiteKey={captchaSiteKey}
        captchaRequired={captchaRequired}
        initialSlotNumber={initialSlotNumber}
      />
    </section>
  );
}

function slotNumberFromQuery(
  rawX: string | string[] | undefined,
  rawY: string | string[] | undefined,
): number | null {
  if (
    typeof rawX !== "string" ||
    typeof rawY !== "string" ||
    !/^\d+$/u.test(rawX) ||
    !/^\d+$/u.test(rawY)
  ) {
    return null;
  }
  const x = Number(rawX);
  const y = Number(rawY);
  try {
    return toSlotNumber(x, y);
  } catch {
    return null;
  }
}
