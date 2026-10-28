import type { Category, MessageVisibility, Visibility } from "@/domain/schemas";

import { CATEGORY_OPTIONS } from "./ui-contracts";

export type PreviewSurface = "map" | "link" | "image";

export function EmaPreview({
  wishText,
  nickname,
  category,
  visibility,
  messageVisibility,
  surface,
  slotNumber,
}: {
  wishText: string;
  nickname: string | null;
  category: Category;
  visibility: Visibility;
  messageVisibility: MessageVisibility;
  surface: PreviewSurface;
  slotNumber?: number | null;
}) {
  const categoryLabel =
    CATEGORY_OPTIONS.find((option) => option.value === category)?.label ??
    "その他";
  const mapPlaceholder = surface === "map" && visibility === "unlisted";
  const publicMessage =
    messageVisibility === "owner_only"
      ? "ひみつの願い"
      : wishText.trim() || "あなたの願い";
  const publicNickname = nickname?.trim() || "ななしさん";

  if (mapPlaceholder) {
    return (
      <div
        className="ema-preview ema-preview--occupied"
        role="img"
        aria-label="使用中の場所。リンク限定のため内容は地図に表示されません。"
      >
        <span className="ema-preview__occupied-mark" aria-hidden="true">
          掛
        </span>
        <strong>使用中の場所</strong>
        <span>リンク限定の絵馬です</span>
      </div>
    );
  }

  return (
    <div
      className="ema-preview"
      role="img"
      aria-label={`${categoryLabel}の絵馬。${publicMessage}。${publicNickname}`}
    >
      <span className="ema-preview__cord" aria-hidden="true" />
      <div className="ema-preview__face">
        <p className="ema-preview__message">{publicMessage}</p>
        <p className="ema-preview__nickname">{publicNickname}</p>
      </div>
      <footer className="ema-preview__meta">
        <span>{categoryLabel}</span>
        {slotNumber ? (
          <span>場所 {slotNumber.toLocaleString("ja-JP")}</span>
        ) : null}
      </footer>
    </div>
  );
}

export function PreviewSurfaceTabs({
  value,
  onChange,
}: {
  value: PreviewSurface;
  onChange: (surface: PreviewSurface) => void;
}) {
  const options: readonly { value: PreviewSurface; label: string }[] = [
    { value: "map", label: "地図" },
    { value: "link", label: "リンク先" },
    { value: "image", label: "共有画像" },
  ];

  return (
    <div className="preview-tabs" role="group" aria-label="公開時の表示場所">
      {options.map((option) => (
        <button
          key={option.value}
          className="preview-tabs__button"
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
