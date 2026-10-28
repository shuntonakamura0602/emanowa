import { rename, writeFile } from "node:fs/promises";

import {
  assertDevelopmentOnly,
  demoFixturePath,
  ensureSafeDemoDirectory,
} from "./demo-fixture-lib.mjs";

assertDevelopmentOnly();
await ensureSafeDemoDirectory();

const fixture = {
  schemaVersion: 1,
  kind: "development-fixture",
  notice: "サンプル。実際の投稿数や本番保存として扱わないでください。",
  world: {
    slug: "2027",
    name: "2027年のえまのわ",
    width: 1000,
    height: 1000,
  },
  emas: [
    {
      fixtureLabel: "サンプル",
      publicId: "00000000-0000-4000-8000-000000000001",
      x: 500,
      y: 500,
      slotNumber: 500501,
      nickname: "ななしさん",
      category: "challenge",
      designId: "basic_wood",
      visibility: "public",
      messageVisibility: "public",
      messageText: "新しい一歩を踏み出せますように",
      version: 1,
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
    },
    {
      fixtureLabel: "サンプル",
      publicId: "00000000-0000-4000-8000-000000000002",
      x: 501,
      y: 500,
      slotNumber: 500502,
      nickname: "えまのわさん",
      category: "other",
      designId: "basic_wood",
      visibility: "public",
      messageVisibility: "owner_only",
      messageText: null,
      version: 1,
      createdAt: "2026-10-28T00:01:00.000Z",
      updatedAt: "2026-10-28T00:01:00.000Z",
    },
  ],
};

const temporaryPath = `${demoFixturePath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(fixture, null, 2)}\n`, {
  encoding: "utf8",
  flag: "w",
});
await rename(temporaryPath, demoFixturePath);

console.info("開発用サンプルを .demo/ema-fixtures.json に作成しました。");
