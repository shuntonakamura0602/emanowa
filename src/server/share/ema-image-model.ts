import type { PublicEma } from "@/domain";

export const EMA_IMAGE_VARIANTS = ["og", "square"] as const;

export type EmaImageVariant = (typeof EMA_IMAGE_VARIANTS)[number];

export type EmaImageModel = {
  width: 1200 | 1080;
  height: 630 | 1080;
  yearLabel: string;
  slotLabel: string;
  nickname: string;
  messageLines: string[];
  messageIsPrivate: boolean;
  replacedEmoji: boolean;
};

const graphemeSegmenter = new Intl.Segmenter("ja", {
  granularity: "grapheme",
});
const emojiPattern = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

function graphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map(({ segment }) => segment);
}

/**
 * ImageResponse obtains missing emoji glyphs from a third-party CDN. Public
 * image generation must remain deterministic even when that service is down,
 * so emoji graphemes use an explicit in-card marker instead of disappearing.
 */
export function replaceImageEmoji(value: string): {
  text: string;
  replaced: boolean;
} {
  let replaced = false;
  const text = graphemes(value)
    .map((grapheme) => {
      if (!emojiPattern.test(grapheme)) return grapheme;
      replaced = true;
      return "◇";
    })
    .join("");
  return { text, replaced };
}

function wrapImageText(
  value: string,
  lineLength: number,
  maxLines: number,
): string[] {
  const sourceLines = value.split("\n");
  const wrapped: string[] = [];

  for (const sourceLine of sourceLines) {
    const units = graphemes(sourceLine);
    if (units.length === 0) {
      wrapped.push("");
      continue;
    }
    for (let index = 0; index < units.length; index += lineLength) {
      wrapped.push(units.slice(index, index + lineLength).join(""));
    }
  }

  if (wrapped.length <= maxLines) return wrapped;

  // Explicit line breaks plus wrapping can otherwise exceed the rendered
  // line budget. Rebalance the complete text rather than truncating it.
  // A Japanese full-width space keeps explicit line boundaries visible.
  const combined = sourceLines.flatMap((line, index) => [
    ...(index > 0 ? ["　"] : []),
    ...graphemes(line),
  ]);
  const balancedLength = Math.max(1, Math.ceil(combined.length / maxLines));
  return Array.from({ length: maxLines }, (_, index) =>
    combined
      .slice(index * balancedLength, (index + 1) * balancedLength)
      .join(""),
  ).filter((line) => line.length > 0);
}

export function createEmaImageModel(
  ema: PublicEma,
  variant: EmaImageVariant,
): EmaImageModel {
  const messageIsPrivate = ema.messageText === null;
  const message = replaceImageEmoji(
    ema.messageText === null ? "願いはひみつです" : ema.messageText,
  );
  const nickname = replaceImageEmoji(ema.nickname ?? "ななしさん");
  const square = variant === "square";

  return {
    width: square ? 1080 : 1200,
    height: square ? 1080 : 630,
    yearLabel: `${ema.worldSlug}年`,
    slotLabel: `${ema.slotNumber.toLocaleString("ja-JP")}番`,
    nickname: nickname.text,
    messageLines: wrapImageText(message.text, square ? 16 : 20, square ? 5 : 4),
    messageIsPrivate,
    replacedEmoji: message.replaced || nickname.replaced,
  };
}

export function publicEmaImageFingerprint(ema: PublicEma): string {
  return `${ema.publicId}:${ema.version}:${ema.updatedAt}`;
}
