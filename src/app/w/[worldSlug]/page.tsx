import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmptyState,
  PageIntro,
  WorldBreadcrumb,
} from "@/components/site-shell";
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
  const safeWorld = encodeURIComponent(worldSlug);

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬を眺める" />
      <PageIntro eyebrow={worldSlug + "年"} title="みんなの願いを眺める">
        <p>
          地図と一覧は同じ公開情報を使います。本文を自分だけにした願いは、公開画面へ渡しません。
        </p>
      </PageIntro>

      <div className="action-row">
        <Link className="button" href={"/w/" + safeWorld + "/new"}>
          絵馬を書く
        </Link>
        <Link className="button button--secondary" href="/me">
          自分の絵馬
        </Link>
        <a className="button button--quiet" href="#ema-list">
          一覧で見る
        </a>
      </div>

      <div className="world-layout">
        <section className="world-panel" aria-labelledby="world-map-title">
          <header className="world-panel__header">
            <h2 id="world-map-title">絵馬の地図</h2>
            <span className="fine-print">地図は段階Dで接続します</span>
          </header>
          <div className="map-placeholder">
            <div className="map-placeholder__message">
              <h3>まだ地図データへ接続していません</h3>
              <p>
                未取得の場所を空き枠として表示せず、接続後に占有状況を確認します。
              </p>
            </div>
          </div>
        </section>

        <section
          className="world-panel list-panel"
          id="ema-list"
          aria-labelledby="ema-list-title"
        >
          <h2 className="fine-print" id="ema-list-title">
            一覧による代替表示
          </h2>
          <EmptyState title="公開絵馬の一覧">
            実データを取得できる段階まで、架空の願いや件数は表示しません。
          </EmptyState>
        </section>
      </div>
    </section>
  );
}
