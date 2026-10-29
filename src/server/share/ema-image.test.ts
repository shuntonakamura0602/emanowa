import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { PublicEma } from "@/domain";

vi.mock("server-only", () => ({}));

import { renderEmaImage } from "./ema-image";

const EMA: PublicEma = {
  publicId: "123e4567-e89b-42d3-a456-426614174000",
  worldSlug: "2027",
  x: 500,
  y: 500,
  slotNumber: 500_501,
  nickname: "願い人🌸",
  category: "other",
  designId: "basic_wood",
  visibility: "public",
  messageVisibility: "public",
  messageText: `${"叶".repeat(30)}\n${"🌸".repeat(10)}${"家".repeat(39)}`,
  version: 1,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
};

describe("ema image renderer", () => {
  it.each([
    ["og", 1200, 630],
    ["square", 1080, 1080],
  ] as const)(
    "renders the %s variant as an exact PNG",
    async (variant, width, height) => {
      const bytes = Buffer.from(await renderEmaImage(EMA, variant));

      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(width);
      expect(bytes.readUInt32BE(20)).toBe(height);
      const previewDirectory = process.env.EMANOWA_IMAGE_PREVIEW_DIR;
      if (previewDirectory) {
        await writeFile(join(previewDirectory, `${variant}.png`), bytes);
      }
    },
  );
});
