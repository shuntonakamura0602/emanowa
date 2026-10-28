import { notFound } from "next/navigation";

import {
  EmaShape,
  PageIntro,
  StageCard,
  WorldBreadcrumb,
} from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";

export default async function NewEmaPage({
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
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬を書く" />
      <PageIntro eyebrow="新しい絵馬" title="願いを書く">
        <p>
          保存処理は段階Cで接続します。現在は入力項目と公開範囲の説明だけを確認できます。
        </p>
      </PageIntro>

      <div className="form-layout">
        <form className="form-card" aria-describedby="form-status">
          <div className="field">
            <label htmlFor="wishText">叶えたいこと</label>
            <textarea
              id="wishText"
              name="wishText"
              rows={4}
              maxLength={80}
              placeholder="叶えたいことを書いてください"
              disabled
            />
            <p className="field__hint">
              1〜80文字。見た目の文字単位で数えます。
            </p>
          </div>

          <div className="field">
            <label htmlFor="nickname">表示名（任意）</label>
            <input
              id="nickname"
              name="nickname"
              maxLength={20}
              placeholder="ななしさん"
              disabled
            />
            <p className="field__hint">
              表示名は公開情報です。願いをひみつにしても表示されます。
            </p>
          </div>

          <div className="field">
            <label htmlFor="category">願いの種類</label>
            <select id="category" name="category" defaultValue="other" disabled>
              <option value="family">家族</option>
              <option value="health">健康</option>
              <option value="study">学び・合格</option>
              <option value="work">仕事</option>
              <option value="love">恋愛・ご縁</option>
              <option value="challenge">挑戦</option>
              <option value="other">その他</option>
            </select>
          </div>

          <fieldset className="field choice-list">
            <legend>みんなの地図への掲載</legend>
            <label className="choice">
              <input type="radio" name="visibility" defaultChecked disabled />
              <span>
                <strong>みんなの地図や一覧に表示する</strong>
                <br />
                <span className="fine-print">個別ページにも表示されます。</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="visibility" disabled />
              <span>
                <strong>リンクを知っている人に見せる</strong>
                <br />
                <span className="fine-print">
                  地図には使用中の場所としてだけ表示します。
                </span>
              </span>
            </label>
          </fieldset>

          <fieldset className="field choice-list">
            <legend>願い本文の公開</legend>
            <label className="choice">
              <input
                type="radio"
                name="messageVisibility"
                defaultChecked
                disabled
              />
              <span>願いの本文も見せる</span>
            </label>
            <label className="choice">
              <input type="radio" name="messageVisibility" disabled />
              <span>願いの本文は自分だけが見る</span>
            </label>
          </fieldset>

          <p className="fine-print" id="form-status">
            外部サービス未接続のため入力と保存を停止しています。保存前に場所と公開範囲をもう一度確認する画面を追加します。
          </p>
          <button className="button" type="submit" disabled>
            この場所に掛ける
          </button>
        </form>

        <aside>
          <StageCard title="公開時の見え方" tone="warm">
            <EmaShape label="標準の木の絵馬プレビュー" />
            <p>
              本文を自分だけにした場合、公開側には原文を渡さず「ひみつの願い」と表示します。
            </p>
          </StageCard>
        </aside>
      </div>
    </section>
  );
}
