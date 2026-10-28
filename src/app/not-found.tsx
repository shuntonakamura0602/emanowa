import Link from "next/link";

import { PageIntro, StageCard } from "@/components/site-shell";
import { FEATURED_WORLD_SLUG } from "@/config/worlds";

export default function NotFoundPage() {
  return (
    <section className="container page-section">
      <PageIntro eyebrow="見つかりません" title="このページは表示できません">
        <p>
          年度、絵馬のID、または公開状態を確認できませんでした。削除・非表示・未登録の場合も、内容や管理情報は表示しません。
        </p>
      </PageIntro>
      <StageCard title="えまのわへ戻る">
        <p>
          現在案内している年度から、公開されている絵馬や新しい一枚への入口を確認できます。
        </p>
        <Link
          className="button button--secondary"
          href={`/w/${FEATURED_WORLD_SLUG}`}
        >
          {FEATURED_WORLD_SLUG}年のえまのわを見る
        </Link>
      </StageCard>
    </section>
  );
}
