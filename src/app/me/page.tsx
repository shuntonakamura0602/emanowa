import { OwnerDashboard } from "@/components/ema/owner-dashboard";
import { PageIntro } from "@/components/site-shell";
import { FEATURED_WORLD_SLUG } from "@/config/worlds";
import { getPublicRuntimeConfig } from "@/server/config";

export default function MePage() {
  const { captchaSiteKey, captchaRequired } = getPublicRuntimeConfig();

  return (
    <section className="container page-section">
      <PageIntro eyebrow="本人管理" title="自分の絵馬">
        <p>
          この端末で掛けた絵馬の編集・削除と、別の端末へ引き継ぐためのメール設定ができます。
        </p>
      </PageIntro>
      <OwnerDashboard
        worldSlug={FEATURED_WORLD_SLUG}
        captchaSiteKey={captchaSiteKey}
        captchaRequired={captchaRequired}
      />
    </section>
  );
}
