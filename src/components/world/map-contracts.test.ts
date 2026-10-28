import { describe, expect, it } from "vitest";

import {
  MAX_VISIBLE_CHUNKS,
  MAX_CACHED_CHUNKS,
  PUBLIC_FEED_PAGE_SIZE,
  PUBLIC_FEED_REFRESH_MS,
  cameraForCoordinate,
  cameraForWholeWorld,
  cameraSearchParams,
  canvasPointFromWorld,
  chooseInitialOverviewCamera,
  createPublicEmaPage,
  densityForCellPx,
  isTapDistance,
  parseLocationCamera,
  parseStoredCamera,
  pruneMapCache,
  visibleChunks,
  worldLocationHref,
  worldPointFromCanvas,
  zoomCameraAt,
  type Camera,
  type Viewport,
  type PublicEma,
} from "./map-contracts";

const viewport: Viewport = { width: 800, height: 400 };

describe("段階Dのカメラ契約", () => {
  it("Canvasとworld座標を四隅でも往復変換する", () => {
    const camera: Camera = { centerX: 500, centerY: 500, cellPx: 1 };
    for (const point of [
      { x: 0, y: 300 },
      { x: 400, y: 300 },
      { x: 0, y: 700 },
      { x: 400, y: 700 },
    ]) {
      const canvas = canvasPointFromWorld(point, camera, viewport);
      expect(worldPointFromCanvas(canvas, camera, viewport)).toEqual(point);
    }
  });

  it("ポインター位置を保ったままズームする", () => {
    const camera: Camera = { centerX: 500, centerY: 500, cellPx: 20 };
    const anchor = { x: 620, y: 140 };
    const before = worldPointFromCanvas(anchor, camera, viewport);
    const zoomed = zoomCameraAt(camera, viewport, anchor, 40);
    const after = worldPointFromCanvas(anchor, zoomed, viewport);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it("全体表示をworld中央に合わせる", () => {
    expect(cameraForWholeWorld(viewport)).toEqual({
      centerX: 500,
      centerY: 500,
      cellPx: 0.4,
    });
    expect(cameraForWholeWorld({ width: 120, height: 80 })).toEqual({
      centerX: 500,
      centerY: 500,
      cellPx: 0.08,
    });
  });

  it("表示密度を仕様の境界で切り替える", () => {
    expect(densityForCellPx(3.99)).toBe("overview-100");
    expect(densityForCellPx(4)).toBe("overview-20");
    expect(densityForCellPx(23.99)).toBe("overview-20");
    expect(densityForCellPx(24)).toBe("individual");
  });

  it("6pxまではタップ、超える移動はドラッグにする", () => {
    expect(isTapDistance({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
    expect(isTapDistance({ x: 0, y: 0 }, { x: 6.01, y: 0 })).toBe(false);
  });
});

describe("段階Dのチャンク・URL契約", () => {
  it("近景は先読みを含めても最大16チャンクに制限する", () => {
    const chunks = visibleChunks(
      { centerX: 500, centerY: 500, cellPx: 24 },
      viewport,
    );
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBeLessThanOrEqual(MAX_VISIBLE_CHUNKS);
    expect(
      chunks!
        .slice(0, 4)
        .every(
          ({ cx, cy }) => (cx === 24 || cx === 25) && (cy === 24 || cy === 25),
        ),
    ).toBe(true);

    expect(
      visibleChunks(
        { centerX: 500, centerY: 500, cellPx: 24 },
        { width: 2_000, height: 1_200 },
      ),
    ).toBeNull();

    const zoomedFromOverview = visibleChunks(
      { centerX: 500, centerY: 500, cellPx: 64 },
      { width: 1_440, height: 900 },
    );
    expect(zoomedFromOverview).not.toBeNull();
    expect(zoomedFromOverview!.length).toBeLessThanOrEqual(MAX_VISIBLE_CHUNKS);
  });

  it("worldの端で範囲外チャンクを要求しない", () => {
    const chunks = visibleChunks(cameraForCoordinate(0, 0, 80), viewport)!;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(({ cx, cy }) => cx >= 0 && cy >= 0)).toBe(true);
    expect(chunks.some(({ cx, cy }) => cx === 0 && cy === 0)).toBe(true);
  });

  it("表示端がチャンク境界と一致しても画面外チャンクを可視扱いしない", () => {
    const chunks = visibleChunks(
      { centerX: 10, centerY: 10, cellPx: 40 },
      { width: 800, height: 800 },
      0,
    );
    expect(chunks).toEqual([{ cx: 0, cy: 0 }]);
  });

  it("チャンクcacheは保護中の可視範囲を残して64件以下にする", () => {
    const cache = new Map(
      Array.from(
        { length: MAX_CACHED_CHUNKS + 3 },
        (_, index) => [String(index), index] as const,
      ),
    );
    const removed = pruneMapCache(cache, new Set(["0", "1"]));
    expect(cache.size).toBe(MAX_CACHED_CHUNKS);
    expect(cache.has("0")).toBe(true);
    expect(cache.has("1")).toBe(true);
    expect(removed).toEqual(["2", "3", "4"]);
  });

  it("公開一覧はcursorごとに24件のページへ置換し、重複を保持しない", () => {
    const page = createPublicEmaPage(
      [...Array.from({ length: 24 }, (_, index) => makeEma(index)), makeEma(0)],
      "cursor-for-page-7",
      "cursor-for-page-8",
      7,
    );
    expect(page.items).toHaveLength(PUBLIC_FEED_PAGE_SIZE);
    expect(new Set(page.items.map((item) => item.publicId)).size).toBe(
      PUBLIC_FEED_PAGE_SIZE,
    );
    expect(page.pageNumber).toBe(7);
    expect(page.currentPageCursor).toBe("cursor-for-page-7");
    expect(page.nextCursor).toBe("cursor-for-page-8");

    const nextPage = createPublicEmaPage(
      Array.from({ length: 24 }, (_, index) => makeEma(index + 24)),
      page.nextCursor,
      "cursor-for-page-9",
      page.pageNumber + 1,
    );
    expect(nextPage.items[0]?.publicId).toBe(makeEma(24).publicId);
    expect(
      nextPage.items.some((item) => item.publicId === makeEma(0).publicId),
    ).toBe(false);
    expect(nextPage.pageNumber).toBe(8);
  });

  it("公開一覧の再取得間隔は30秒に固定する", () => {
    expect(PUBLIC_FEED_REFRESH_MS).toBe(30_000);
  });

  it("有効な位置URLだけを復元し、zは許容範囲へ収める", () => {
    expect(parseLocationCamera("?x=0&y=999&z=999")).toEqual({
      centerX: 0.5,
      centerY: 999.5,
      cellPx: 128,
    });
    expect(parseLocationCamera("?x=1000&y=0&z=64")).toBeNull();
    expect(parseLocationCamera("?x=1.5&y=0")).toBeNull();
    expect(parseLocationCamera("?x=1&y=2&z=not-a-number")).toBeNull();
  });

  it("位置共有URLは他のqueryを保ち、小数2桁で更新する", () => {
    expect(
      cameraSearchParams("category=study", {
        centerX: 12.6,
        centerY: 20.4,
        cellPx: 64.126,
      }),
    ).toBe("category=study&x=12&y=20&z=64.13");
  });

  it("個別詳細の地図URLはworldをencodeし、作品座標とz=80だけを渡す", () => {
    expect(worldLocationHref("2027/特別", 12, 34)).toBe(
      "/w/2027%2F%E7%89%B9%E5%88%A5?x=12&y=34&z=80",
    );
    expect(worldLocationHref("2027", 12, 34)).not.toContain("publicId");
  });

  it("不正な保存カメラを復元しない", () => {
    expect(parseStoredCamera("not-json")).toBeNull();
    expect(
      parseStoredCamera(
        JSON.stringify({ centerX: 500, centerY: 500, cellPx: 64 }),
      ),
    ).toEqual({ centerX: 500, centerY: 500, cellPx: 64 });
    expect(
      parseStoredCamera(
        JSON.stringify({ centerX: -1, centerY: 500, cellPx: 64 }),
      ),
    ).toBeNull();
  });

  it("公開絵馬がある集計セルを初期位置に選ぶ", () => {
    expect(
      chooseInitialOverviewCamera({
        cellSize: 100,
        asOf: "2026-10-28T00:00:00Z",
        cells: [
          {
            x: 0,
            y: 0,
            occupiedCount: 8,
            activeCount: 8,
            listedCount: 3,
          },
          {
            x: 100,
            y: 200,
            occupiedCount: 4,
            activeCount: 4,
            listedCount: 3,
          },
        ],
      }),
    ).toEqual({ centerX: 150, centerY: 250, cellPx: 64 });
  });

  it("初期位置は公開件数だけで満杯セルを優先しない", () => {
    expect(
      chooseInitialOverviewCamera({
        cellSize: 20,
        asOf: "2026-10-28T00:00:00Z",
        cells: [
          {
            x: 0,
            y: 0,
            occupiedCount: 400,
            activeCount: 400,
            listedCount: 400,
          },
          {
            x: 20,
            y: 0,
            occupiedCount: 8,
            activeCount: 8,
            listedCount: 5,
          },
        ],
      }),
    ).toEqual({ centerX: 30, centerY: 10, cellPx: 64 });
  });
});

function makeEma(index: number): PublicEma {
  const x = index % 1_000;
  const y = Math.floor(index / 1_000);
  return {
    publicId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    worldSlug: "2027",
    x,
    y,
    slotNumber: y * 1_000 + x + 1,
    nickname: null,
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
    messageText: "願い",
    version: 1,
    createdAt: "2026-10-28T00:00:00Z",
    updatedAt: "2026-10-28T00:00:00Z",
  };
}
