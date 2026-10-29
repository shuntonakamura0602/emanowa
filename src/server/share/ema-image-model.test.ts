import { describe, expect, it } from "vitest";

import type { PublicEma } from "@/domain";

import {
  createEmaImageModel,
  publicEmaImageFingerprint,
  replaceImageEmoji,
} from "./ema-image-model";

const BASE_EMA: PublicEma = {
  publicId: "123e4567-e89b-42d3-a456-426614174000",
  worldSlug: "2026",
  x: 3,
  y: 2,
  slotNumber: 2_004,
  nickname: "願い人",
  category: "other",
  designId: "basic_wood",
  visibility: "public",
  messageVisibility: "public",
  messageText: "穏やかな一年になりますように",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ema image model", () => {
  it("uses exact dimensions for both public image variants", () => {
    expect(createEmaImageModel(BASE_EMA, "og")).toMatchObject({
      width: 1200,
      height: 630,
      yearLabel: "2026年",
      slotLabel: "2,004番",
    });
    expect(createEmaImageModel(BASE_EMA, "square")).toMatchObject({
      width: 1080,
      height: 1080,
    });
  });

  it("never needs or accepts a private wish to draw the fixed private face", () => {
    const model = createEmaImageModel(
      {
        ...BASE_EMA,
        messageVisibility: "owner_only",
        messageText: null,
      },
      "og",
    );
    expect(model.messageLines.join("\n")).toBe("願いはひみつです");
    expect(model.messageIsPrivate).toBe(true);
  });

  it("wraps all 80 Japanese graphemes inside each variant line budget", () => {
    const square = createEmaImageModel(
      { ...BASE_EMA, messageText: "願".repeat(80) },
      "square",
    );
    const og = createEmaImageModel(
      { ...BASE_EMA, messageText: "願".repeat(80) },
      "og",
    );
    expect(square.messageLines).toHaveLength(5);
    expect(square.messageLines.every((line) => [...line].length <= 16)).toBe(
      true,
    );
    expect(square.messageLines.join("")).toBe("願".repeat(80));
    expect(og.messageLines).toHaveLength(4);
    expect(og.messageLines.every((line) => [...line].length <= 20)).toBe(true);
    expect(og.messageLines.join("")).toBe("願".repeat(80));
  });

  it("marks emoji graphemes deterministically without an external font URL", () => {
    expect(replaceImageEmoji("家族👨‍👩‍👧‍👦と初詣🎍")).toEqual({
      text: "家族◇と初詣◇",
      replaced: true,
    });
  });

  it("changes the fingerprint when a public projection version changes", () => {
    expect(publicEmaImageFingerprint(BASE_EMA)).not.toBe(
      publicEmaImageFingerprint({ ...BASE_EMA, version: 2 }),
    );
  });
});
