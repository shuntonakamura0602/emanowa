import { describe, expect, it } from "vitest";

import {
  chunkResponseSchema,
  countGraphemes,
  createEmaInputSchema,
  fromSlotNumber,
  idempotencyKeySchema,
  isRequestBodyWithinLimit,
  emaStatusSchema,
  mutationReceiptSchema,
  nicknameSchema,
  overviewResponseSchema,
  ownerEmaSchema,
  projectChunkCell,
  projectPublicEma,
  publicEmaSchema,
  publicEmaListResponseSchema,
  randomEmaResponseSchema,
  toChunkCoordinates,
  toSlotNumber,
  updateEmaInputSchema,
  wishTextSchema,
  worldStatsSchema,
} from "./index";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";
const CREATED_AT = "2026-12-19T15:00:00Z";
const UPDATED_AT = "2026-12-20T00:00:00Z";
const SECRET_WISH = "この本文は本人だけが読める秘密の願い";

const ownerFixture = ownerEmaSchema.parse({
  publicId: PUBLIC_ID,
  worldSlug: "2027",
  x: 2,
  y: 3,
  slotNumber: 3003,
  nickname: "えま太郎",
  category: "health",
  designId: "basic_wood",
  visibility: "public",
  messageVisibility: "owner_only",
  wishText: SECRET_WISH,
  status: "active",
  version: 1,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  capabilities: {
    editContent: true,
    visibilityMode: "all",
    delete: true,
  },
});

describe("座標契約", () => {
  it.each([
    [0, 0, 1],
    [999, 0, 1000],
    [0, 1, 1001],
    [999, 999, 1_000_000],
  ])("(%i, %i) を表示番号 %i と相互変換する", (x, y, slotNumber) => {
    expect(toSlotNumber(x, y)).toBe(slotNumber);
    expect(fromSlotNumber(slotNumber)).toEqual({ x, y });
  });

  it("範囲外や小数を端へ補正せず拒否する", () => {
    expect(() => toSlotNumber(-1, 0)).toThrow();
    expect(() => toSlotNumber(1000, 0)).toThrow();
    expect(() => toSlotNumber(0.5, 0)).toThrow();
    expect(() => fromSlotNumber(0)).toThrow();
  });

  it("20×20チャンクへ変換する", () => {
    expect(toChunkCoordinates(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(toChunkCoordinates(999, 999)).toEqual({ cx: 49, cy: 49 });
  });

  it("内部状態は削除済みを表せるが、本人DTOには返さない", () => {
    expect(emaStatusSchema.parse("deleted")).toBe("deleted");
    expect(
      ownerEmaSchema.safeParse({ ...ownerFixture, status: "deleted" }).success,
    ).toBe(false);
  });
});

describe("日本語入力の正規化と制限", () => {
  it("CRLFをLFへ変換し、NFC正規化と前後空白除去を行う", () => {
    expect(wishTextSchema.parse("  か\u3099\r\n願い  ")).toBe("が\n願い");
  });

  it("80書記素は受け付け、81書記素は拒否する", () => {
    expect(wishTextSchema.safeParse("願".repeat(80)).success).toBe(true);
    expect(wishTextSchema.safeParse("願".repeat(81)).success).toBe(false);
  });

  it("ZWJ絵文字と結合文字を書記素単位で数える", () => {
    expect(countGraphemes("👨‍👩‍👧‍👦")).toBe(1);
    expect(countGraphemes("か\u3099")).toBe(1);
    expect(wishTextSchema.safeParse("👨‍👩‍👧‍👦".repeat(80)).success).toBe(true);
  });

  it("空白だけ、5行、制御文字、双方向制御を拒否する", () => {
    expect(wishTextSchema.safeParse(" 　 ").success).toBe(false);
    expect(wishTextSchema.safeParse("1\n2\n3\n4\n5").success).toBe(false);
    expect(wishTextSchema.safeParse("願い\u0000").success).toBe(false);
    expect(wishTextSchema.safeParse("abc\u202Etxt").success).toBe(false);
  });

  it("書記素数内でもUTF-8上限を超える入力を拒否する", () => {
    const oversizedSingleGrapheme = `a${"\u0301".repeat(4096)}`;
    expect(countGraphemes(oversizedSingleGrapheme)).toBe(1);
    expect(wishTextSchema.safeParse(oversizedSingleGrapheme).success).toBe(
      false,
    );
  });

  it("表示名は空文字をnullにし、改行と21書記素を拒否する", () => {
    expect(nicknameSchema.parse("   ")).toBeNull();
    expect(nicknameSchema.safeParse("名".repeat(20)).success).toBe(true);
    expect(nicknameSchema.safeParse("名\n前").success).toBe(false);
    expect(nicknameSchema.safeParse("名".repeat(21)).success).toBe(false);
  });

  it("生のJSON本文を8KiBまでに制限できる", () => {
    expect(isRequestBodyWithinLimit("a".repeat(8 * 1024))).toBe(true);
    expect(isRequestBodyWithinLimit("a".repeat(8 * 1024 + 1))).toBe(false);
  });
});

describe("変更入力と識別子の契約", () => {
  const createInput = {
    x: 10,
    y: 20,
    wishText: "家族が元気で過ごせますように",
    nickname: null,
    category: "family",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
  } as const;

  it("定義済みCreateEmaInputだけを受け付ける", () => {
    expect(createEmaInputSchema.safeParse(createInput).success).toBe(true);
    expect(
      createEmaInputSchema.safeParse({ ...createInput, ownerId: PUBLIC_ID })
        .success,
    ).toBe(false);
    expect(
      createEmaInputSchema.safeParse({ ...createInput, publicId: PUBLIC_ID })
        .success,
    ).toBe(false);
  });

  it("空PATCH、未知キー、座標変更を拒否し、nickname:nullは保持する", () => {
    expect(updateEmaInputSchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      updateEmaInputSchema.safeParse({ expectedVersion: 1, x: 2 }).success,
    ).toBe(false);
    expect(
      updateEmaInputSchema.parse({ expectedVersion: 1, nickname: null })
        .nickname,
    ).toBeNull();
  });

  it("UUID v4だけを冪等キーとして受け付ける", () => {
    expect(idempotencyKeySchema.safeParse(IDEMPOTENCY_KEY).success).toBe(true);
    expect(
      idempotencyKeySchema.safeParse("123e4567-e89b-12d3-a456-426614174000")
        .success,
    ).toBe(false);
    expect(idempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("公開DTOと本人DTOの秘密境界", () => {
  it("OwnerEmaはwishTextを持ち、PublicEmaはwishTextを未知キーとして拒否する", () => {
    expect(ownerFixture.wishText).toBe(SECRET_WISH);
    expect(
      publicEmaSchema.safeParse({
        ...ownerFixture,
        messageText: null,
      }).success,
    ).toBe(false);
  });

  it("owner_only本文を公開投影のどのプロパティにも含めない", () => {
    const projected = projectPublicEma(ownerFixture);

    expect(projected).not.toBeNull();
    expect(projected?.messageText).toBeNull();
    expect(JSON.stringify(projected)).not.toContain(SECRET_WISH);
    expect(projected).not.toHaveProperty("wishText");
  });

  it("公開本文だけをmessageTextへ投影する", () => {
    const projected = projectPublicEma({
      ...ownerFixture,
      messageVisibility: "public",
    });

    expect(projected?.messageText).toBe(SECRET_WISH);
    expect(projected).not.toHaveProperty("wishText");
  });

  it("owner_onlyなのに本文を持つPublicEmaを拒否する", () => {
    const projected = projectPublicEma(ownerFixture);
    expect(
      publicEmaSchema.safeParse({ ...projected, messageText: SECRET_WISH })
        .success,
    ).toBe(false);
  });

  it("unlistedとhiddenはチャンクで占有座標だけにする", () => {
    for (const source of [
      { ...ownerFixture, visibility: "unlisted" as const },
      { ...ownerFixture, status: "hidden" as const },
    ]) {
      const cell = projectChunkCell(source);
      const serialized = JSON.stringify(cell);

      expect(cell).toEqual({ kind: "occupied", x: 2, y: 3, slotNumber: 3003 });
      expect(serialized).not.toContain(PUBLIC_ID);
      expect(serialized).not.toContain(SECRET_WISH);
      expect(serialized).not.toContain("えま太郎");
    }
  });

  it("hiddenは個別公開投影でも存在しない扱いにする", () => {
    expect(projectPublicEma({ ...ownerFixture, status: "hidden" })).toBeNull();
  });

  it("一覧とランダムの応答はactive/public投影だけを受け付ける", () => {
    const listed = projectPublicEma({
      ...ownerFixture,
      messageVisibility: "public",
    });
    expect(
      publicEmaListResponseSchema.safeParse({
        items: [listed],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      publicEmaListResponseSchema.safeParse({
        items: [{ ...listed, visibility: "unlisted" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      randomEmaResponseSchema.safeParse({
        item: { ...listed, visibility: "unlisted" },
      }).success,
    ).toBe(false);
  });
});

describe("チャンク・集計・receiptの整合性", () => {
  it("集計セルの位置・件数上限・重複をcellSizeごとに検証する", () => {
    const base = {
      cellSize: 20 as const,
      cells: [
        {
          x: 0,
          y: 20,
          occupiedCount: 400,
          activeCount: 399,
          listedCount: 398,
        },
      ],
      asOf: UPDATED_AT,
    };
    expect(overviewResponseSchema.safeParse(base).success).toBe(true);
    expect(
      overviewResponseSchema.safeParse({
        ...base,
        cells: [{ ...base.cells[0], x: 1 }],
      }).success,
    ).toBe(false);
    expect(
      overviewResponseSchema.safeParse({
        ...base,
        cells: [{ ...base.cells[0], occupiedCount: 401 }],
      }).success,
    ).toBe(false);
    expect(
      overviewResponseSchema.safeParse({
        ...base,
        cells: [base.cells[0], base.cells[0]],
      }).success,
    ).toBe(false);
  });

  it("チャンク外、unlistedのpublic cell、重複座標を拒否する", () => {
    const publicCell = projectChunkCell({
      ...ownerFixture,
      messageVisibility: "public",
    });
    expect(
      chunkResponseSchema.safeParse({
        worldSlug: "2027",
        cx: 0,
        cy: 0,
        revision: 1,
        cells: [publicCell],
      }).success,
    ).toBe(true);
    expect(
      chunkResponseSchema.safeParse({
        worldSlug: "2027",
        cx: 1,
        cy: 1,
        revision: 1,
        cells: [publicCell],
      }).success,
    ).toBe(false);
    expect(
      chunkResponseSchema.safeParse({
        worldSlug: "2027",
        cx: 0,
        cy: 0,
        revision: 1,
        cells: [publicCell, publicCell],
      }).success,
    ).toBe(false);
  });

  it("集計値の大小関係を検証する", () => {
    expect(
      worldStatsSchema.safeParse({
        occupiedCount: 10,
        activeCount: 8,
        listedCount: 6,
        asOf: UPDATED_AT,
      }).success,
    ).toBe(true);
    expect(
      worldStatsSchema.safeParse({
        occupiedCount: 5,
        activeCount: 6,
        listedCount: 6,
        asOf: UPDATED_AT,
      }).success,
    ).toBe(false);
  });

  it("receiptの正規URLがIDと年度に一致することを検証する", () => {
    expect(
      mutationReceiptSchema.safeParse({
        publicId: PUBLIC_ID,
        worldSlug: "2027",
        version: 1,
        result: "created",
        canonicalUrl: `/w/2027/e/${PUBLIC_ID}`,
      }).success,
    ).toBe(true);
    expect(
      mutationReceiptSchema.safeParse({
        publicId: PUBLIC_ID,
        worldSlug: "2027",
        version: 1,
        result: "created",
        canonicalUrl: "/w/2027/e/someone-else",
      }).success,
    ).toBe(false);
  });
});
