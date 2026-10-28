import Link from "next/link";

import { PageIntro, StageCard } from "@/components/site-shell";
import { FEATURED_WORLD_SLUG } from "@/config/worlds";

export const metadata = {
  title: "えまのわについて",
};

export default function AboutPage() {
  return (
    <section className="container page-section">
      <PageIntro eyebrow="えまのわについて" title="願いを掛け、近くに招く場所">
        <p>
          えまのわは、年ごとの100万枠に一人一枚の絵馬を掛け、みんなの願いを眺められる日本語のオンラインサービスです。
        </p>
        <p>神社の参拝・祈祷や宗教上の効力を約束するものではありません。</p>
      </PageIntro>

      <div className="card-grid">
        <StageCard title="登録なしで始める">
          <p>
            閲覧時はアカウントを作らず、書き始めるときにゲスト所有権を準備します。別端末で復元したい場合だけ、あとからメールを連携できます。
          </p>
        </StageCard>
        <StageCard title="一人一枚を大切にする">
          <p>
            一つの認証アカウントにつき、同じ年には一枚。場所は投稿の完了時に確定し、誰かと重なった場合は選び直します。
          </p>
        </StageCard>
      </div>

      <section
        className="page-section--compact"
        aria-labelledby="visibility-title"
      >
        <p className="eyebrow">公開範囲</p>
        <h2 id="visibility-title">
          場所への掲載と、本文の公開を分けて選べます
        </h2>
        <div className="privacy-matrix">
          <div>
            <strong>地図に掲載・本文も公開</strong>
            <span className="muted">
              地図、一覧、個別URLで本文を表示します。
            </span>
          </div>
          <div>
            <strong>地図に掲載・本文は自分だけ</strong>
            <span className="muted">
              絵馬の外観と表示名を出し、本文は渡しません。
            </span>
          </div>
          <div>
            <strong>リンク限定・本文を公開</strong>
            <span className="muted">
              地図には使用中とだけ表示し、URLで本文を見せます。
            </span>
          </div>
          <div>
            <strong>リンク限定・本文は自分だけ</strong>
            <span className="muted">地図にも個別URLにも本文を出しません。</span>
          </div>
        </div>
      </section>

      <Link className="button" href={"/w/" + FEATURED_WORLD_SLUG}>
        えまのわを眺める
      </Link>
    </section>
  );
}
