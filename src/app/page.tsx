import Link from "next/link";

import { EmaShape } from "@/components/site-shell";
import { FEATURED_WORLD_SLUG } from "@/config/worlds";

const featuredWorldSlug = FEATURED_WORLD_SLUG;

export default function HomePage() {
  const worldPath = "/w/" + encodeURIComponent(featuredWorldSlug);

  return (
    <>
      <section className="container hero">
        <div className="hero__copy">
          <p className="eyebrow">{featuredWorldSlug}年のえまのわ</p>
          <h1>あなたの願いを、ここに。</h1>
          <p className="hero__lead">
            みんなの願いが集まる、オンライン絵馬。登録画面を先に通らず、無料で一枚から始められる場所をつくっています。
          </p>
          <div className="hero__actions">
            <Link className="button" href={worldPath + "/new"}>
              絵馬を書く
            </Link>
            <Link className="button button--secondary" href={worldPath}>
              みんなの絵馬を眺める
            </Link>
          </div>
          <p className="fine-print">
            絵馬の作成と本人管理を実装済みです。Canvas地図と近くへの招待は、後続の段階で追加します。
          </p>
        </div>
        <div className="hero__visual" aria-hidden="true">
          <EmaShape />
        </div>
      </section>

      <section
        className="container page-section--compact"
        aria-labelledby="how-it-works"
      >
        <p className="eyebrow">使い方</p>
        <h2 id="how-it-works">一枚の願いを、ゆっくり掛ける</h2>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-card__number" aria-hidden="true">
              1
            </span>
            <h2>願いを書く</h2>
            <p>80文字までの願いと、公開範囲を自分で選びます。</p>
          </article>
          <article className="feature-card">
            <span className="feature-card__number" aria-hidden="true">
              2
            </span>
            <h2>場所を選ぶ</h2>
            <p>100万枠の番号から選び、保存するときに空きを確認します。</p>
          </article>
          <article className="feature-card">
            <span className="feature-card__number" aria-hidden="true">
              3
            </span>
            <h2>あとから管理する</h2>
            <p>
              掛けた後は、自分の絵馬の確認・編集・削除や、任意のメール引継ぎができます。
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
