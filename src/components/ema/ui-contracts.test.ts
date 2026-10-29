import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  applyInitialSlotNumber,
  canonicalCreatePayload,
  createInputFromDraft,
  draftStorageKey,
  existingOwnerEmaFromResponse,
  initialSlotNumberFromLocationQuery,
  isExpectedOwnerPublicId,
  isMutationReceipt,
  messageForApiError,
  nearbySlotCandidates,
  parseStoredDraft,
  readStoredDraft,
  readStoredDraftForAuthContext,
  removeStoredDraft,
  writeStoredDraft,
  type StoredEmaDraft,
} from "./ui-contracts";

describe("段階Cの作成フォーム契約", () => {
  it("表示番号を座標へ変換し、正規化済みの作成入力を返す", () => {
    const result = createInputFromDraft({
      ...EMPTY_DRAFT,
      wishText: "  家族が元気で過ごせますように  ",
      nickname: "   ",
      slotNumber: "1001",
    });

    expect(result.fieldErrors).toEqual({});
    expect(result.input).toEqual({
      x: 0,
      y: 1,
      wishText: "家族が元気で過ごせますように",
      nickname: null,
      category: "other",
      designId: "basic_wood",
      visibility: "public",
      messageVisibility: "public",
    });
  });

  it("範囲外・小数の場所を端へ補正せず拒否する", () => {
    for (const slotNumber of ["0", "1000001", "1.5", "not-a-number"]) {
      const result = createInputFromDraft({
        ...EMPTY_DRAFT,
        wishText: "願い",
        slotNumber,
      });
      expect(result.input).toBeNull();
      expect(result.fieldErrors.slotNumber).toBeTruthy();
    }
  });

  it("80書記素は受け付け、81書記素と5行は拒否する", () => {
    expect(
      createInputFromDraft({
        ...EMPTY_DRAFT,
        wishText: "願".repeat(80),
        slotNumber: "1",
      }).input,
    ).not.toBeNull();
    expect(
      createInputFromDraft({
        ...EMPTY_DRAFT,
        wishText: "願".repeat(81),
        slotNumber: "1",
      }).fieldErrors.wishText,
    ).toBeTruthy();
    expect(
      createInputFromDraft({
        ...EMPTY_DRAFT,
        wishText: "1\n2\n3\n4\n5",
        slotNumber: "1",
      }).fieldErrors.wishText,
    ).toBeTruthy();
  });

  it("同じ入力を同じ冪等payloadにし、空の表示名をnullにする", () => {
    const parsed = createInputFromDraft({
      ...EMPTY_DRAFT,
      wishText: "願い",
      nickname: "",
      slotNumber: "1",
    });
    expect(parsed.input).not.toBeNull();
    const first = canonicalCreatePayload(parsed.input!);
    const second = canonicalCreatePayload(parsed.input!);
    expect(first).toBe(second);
    expect(JSON.parse(first)).toMatchObject({ nickname: null, x: 0, y: 0 });
  });

  it("地図で選び直した場所だけを復元下書きへ反映し、旧送信キーを破棄する", () => {
    const stored: StoredEmaDraft = {
      version: 2,
      authContextEpoch: null,
      values: { ...EMPTY_DRAFT, wishText: "願い", slotNumber: "1" },
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
      idempotencyPayload: "old",
    };
    expect(applyInitialSlotNumber(stored, 1)).toBe(stored);
    expect(applyInitialSlotNumber(stored, 1001)).toEqual({
      ...stored,
      values: { ...stored.values, slotNumber: "1001" },
      idempotencyKey: null,
      idempotencyPayload: null,
    });
  });

  it("nearを座標より優先し、招待候補を本人の代わりに選ばない", () => {
    expect(
      initialSlotNumberFromLocationQuery({
        near: "550e8400-e29b-41d4-a716-446655440000",
        x: "9",
        y: "8",
      }),
    ).toBeNull();
    expect(
      initialSlotNumberFromLocationQuery({
        near: ["550e8400-e29b-41d4-a716-446655440000"],
        x: "9",
        y: "8",
      }),
    ).toBeNull();
    expect(initialSlotNumberFromLocationQuery({ x: "9", y: "8" })).toBe(8010);
    expect(
      initialSlotNumberFromLocationQuery({ x: "1000", y: "8" }),
    ).toBeNull();
  });

  it("編集URLを指定した場合は所有者DTOのpublicIdが一致するときだけ許可する", () => {
    const owned = "550e8400-e29b-41d4-a716-446655440000";
    const other = "660e8400-e29b-41d4-a716-446655440000";
    expect(isExpectedOwnerPublicId(undefined, owned)).toBe(true);
    expect(isExpectedOwnerPublicId(owned, owned)).toBe(true);
    expect(isExpectedOwnerPublicId(owned.toUpperCase(), owned)).toBe(true);
    expect(isExpectedOwnerPublicId(owned, other)).toBe(false);
  });

  it("同一タブの保存形式だけを復元し、不正な値は捨てる", () => {
    const stored: StoredEmaDraft = {
      version: 2,
      authContextEpoch: "123e4567-e89b-42d3-a456-426614174000",
      values: { ...EMPTY_DRAFT, wishText: "願い", slotNumber: "1" },
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
      idempotencyPayload: "{}",
    };
    expect(parseStoredDraft(JSON.stringify(stored))).toEqual(stored);
    expect(
      parseStoredDraft(
        JSON.stringify({
          ...stored,
          values: { ...stored.values, visibility: "private" },
        }),
      ),
    ).toBeNull();
    expect(parseStoredDraft("not-json")).toBeNull();
    expect(
      parseStoredDraft(JSON.stringify({ ...stored, authContextEpoch: "bad" })),
    ).toBeNull();
    expect(
      parseStoredDraft(JSON.stringify({ ...stored, version: 1 })),
    ).toBeNull();
  });

  it("version付きキーで保存し、sessionStorageが使えなくても例外にしない", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
      removeItem: () => {
        value = null;
      },
    };
    const stored: StoredEmaDraft = {
      version: 2,
      authContextEpoch: null,
      values: { ...EMPTY_DRAFT, wishText: "願い", slotNumber: "1" },
      idempotencyKey: null,
      idempotencyPayload: null,
    };

    expect(draftStorageKey("2027")).toBe("emanowa:draft:v2:2027");
    expect(writeStoredDraft(storage, "key", stored)).toBe(true);
    expect(readStoredDraft(storage, "key")).toEqual(stored);
    expect(
      readStoredDraftForAuthContext(storage, "key", stored.authContextEpoch),
    ).toEqual(stored);
    expect(
      readStoredDraftForAuthContext(
        storage,
        "key",
        "223e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBeNull();
    removeStoredDraft(storage, "key");
    expect(readStoredDraft(storage, "key")).toBeNull();

    const unavailable = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
      removeItem: () => {
        throw new Error("unavailable");
      },
    };
    expect(readStoredDraft(unavailable, "key")).toBeNull();
    expect(writeStoredDraft(unavailable, "key", stored)).toBe(false);
    expect(() => removeStoredDraft(unavailable, "key")).not.toThrow();
  });

  it("端の場所ではworld外へ回り込まない近隣候補を返す", () => {
    expect(nearbySlotCandidates(1)).toEqual([2, 1001, 1002]);
    expect(nearbySlotCandidates(1_000_000)).toEqual([
      999_999, 999_000, 998_999,
    ]);
  });
});

describe("段階Cの応答・エラー表示契約", () => {
  it("枠競合と通信制限を仕様の文言へ変換する", () => {
    expect(
      messageForApiError({
        code: "SLOT_TAKEN",
        message: "raw",
        requestId: "request-1",
      }),
    ).toBe(
      "この場所には、先に絵馬が掛けられました。近くの空いている場所を選んでください。",
    );
    expect(
      messageForApiError({
        code: "RATE_LIMITED",
        message: "raw",
        requestId: "request-2",
      }),
    ).toBe("少し時間をおいて、もう一度お試しください。");
  });

  it("成功表示に使えるmutation receiptだけを受け付ける", () => {
    const receipt = {
      publicId: "550e8400-e29b-41d4-a716-446655440000",
      worldSlug: "2027",
      version: 1,
      result: "created",
      canonicalUrl: "/w/2027/e/550e8400-e29b-41d4-a716-446655440000",
    };
    expect(isMutationReceipt(receipt)).toBe(true);
    expect(isMutationReceipt({ ...receipt, publicId: "unsafe" })).toBe(false);
    expect(isMutationReceipt({ ...receipt, version: 0 })).toBe(false);
  });

  it("本人応答は招待ガードに必要な識別子と状態だけへ縮小する", () => {
    const ownerEma = {
      publicId: "550e8400-e29b-41d4-a716-446655440000",
      worldSlug: "2027",
      x: 0,
      y: 0,
      slotNumber: 1,
      nickname: "本人",
      category: "other",
      designId: "basic_wood",
      visibility: "public",
      messageVisibility: "owner_only",
      wishText: "クライアント状態へ残さない本文",
      status: "active",
      version: 1,
      createdAt: "2026-10-28T00:00:00Z",
      updatedAt: "2026-10-28T00:00:00Z",
      capabilities: {
        editContent: true,
        visibilityMode: "all",
        delete: true,
      },
    };
    expect(existingOwnerEmaFromResponse({ ema: ownerEma }, "2027")).toEqual({
      publicId: ownerEma.publicId,
      status: "active",
    });
    expect(existingOwnerEmaFromResponse({ ema: null }, "2027")).toBeNull();
    expect(existingOwnerEmaFromResponse({ ema: ownerEma }, "2028")).toBe(
      undefined,
    );
    expect(existingOwnerEmaFromResponse({ unsafe: ownerEma }, "2027")).toBe(
      undefined,
    );
  });
});
