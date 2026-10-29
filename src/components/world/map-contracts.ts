import {
  CHUNK_AXIS_COUNT,
  CHUNK_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@/domain/constants";
import {
  chunkResponseSchema,
  overviewResponseSchema,
  publicEmaListResponseSchema,
  randomEmaResponseSchema,
  worldResponseSchema,
  type ChunkResponse,
  type OverviewCell,
  type OverviewResponse,
  type PublicEma,
  type PublicEmaListResponse,
  type RandomEmaResponse,
  type WorldResponse,
} from "@/domain/schemas";

export const MIN_CELL_PX = 0.25;
export const MAX_CELL_PX = 128;
export const DETAIL_CELL_PX = 24;
export const MESSAGE_CELL_PX = 80;
export const DRAG_THRESHOLD_PX = 6;
export const MAP_FETCH_DEBOUNCE_MS = 200;
export const MAX_VISIBLE_CHUNKS = 16;
export const MAX_CONCURRENT_CHUNK_REQUESTS = 4;
export const MAX_CACHED_CHUNKS = 64;
export const PUBLIC_FEED_PAGE_SIZE = 24;
export const PUBLIC_FEED_REFRESH_MS = 30_000;

export type Camera = {
  centerX: number;
  centerY: number;
  cellPx: number;
};

export type Viewport = {
  width: number;
  height: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type WorldPoint = {
  x: number;
  y: number;
};

export type ChunkCoordinate = {
  cx: number;
  cy: number;
};

export type PublicEmaPage = {
  items: PublicEma[];
  pageNumber: number;
  currentPageCursor: string | null;
  nextCursor: string | null;
};

export type MapDensity = "overview-100" | "overview-20" | "individual";
export type {
  ChunkResponse,
  OverviewCell,
  OverviewResponse,
  PublicEma,
  PublicEmaListResponse,
  RandomEmaResponse,
  WorldResponse,
};

export const publicMapSchemas = {
  world: worldResponseSchema,
  overview: overviewResponseSchema,
  chunk: chunkResponseSchema,
  list: publicEmaListResponseSchema,
  random: randomEmaResponseSchema,
} as const;

export function clampCellPx(value: number): number {
  if (!Number.isFinite(value)) return 64;
  return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, value));
}

export function clampCamera(camera: Camera, viewport: Viewport): Camera {
  const fittedMinimum = Math.min(
    MIN_CELL_PX,
    viewport.width > 0 ? viewport.width / WORLD_WIDTH : MIN_CELL_PX,
    viewport.height > 0 ? viewport.height / WORLD_HEIGHT : MIN_CELL_PX,
  );
  const cellPx = Number.isFinite(camera.cellPx)
    ? Math.min(MAX_CELL_PX, Math.max(fittedMinimum, camera.cellPx))
    : 64;
  const halfWidth = viewport.width / (2 * cellPx);
  const halfHeight = viewport.height / (2 * cellPx);
  const centerX =
    halfWidth >= WORLD_WIDTH / 2
      ? WORLD_WIDTH / 2
      : clamp(camera.centerX, halfWidth, WORLD_WIDTH - halfWidth);
  const centerY =
    halfHeight >= WORLD_HEIGHT / 2
      ? WORLD_HEIGHT / 2
      : clamp(camera.centerY, halfHeight, WORLD_HEIGHT - halfHeight);
  return { centerX, centerY, cellPx };
}

export function worldPointFromCanvas(
  point: CanvasPoint,
  camera: Camera,
  viewport: Viewport,
): WorldPoint {
  return {
    x: (point.x - viewport.width / 2) / camera.cellPx + camera.centerX,
    y: (point.y - viewport.height / 2) / camera.cellPx + camera.centerY,
  };
}

export function canvasPointFromWorld(
  point: WorldPoint,
  camera: Camera,
  viewport: Viewport,
): CanvasPoint {
  return {
    x: (point.x - camera.centerX) * camera.cellPx + viewport.width / 2,
    y: (point.y - camera.centerY) * camera.cellPx + viewport.height / 2,
  };
}

export function zoomCameraAt(
  camera: Camera,
  viewport: Viewport,
  anchor: CanvasPoint,
  nextCellPx: number,
): Camera {
  const worldAnchor = worldPointFromCanvas(anchor, camera, viewport);
  const cellPx = clampCellPx(nextCellPx);
  return clampCamera(
    {
      centerX: worldAnchor.x - (anchor.x - viewport.width / 2) / cellPx,
      centerY: worldAnchor.y - (anchor.y - viewport.height / 2) / cellPx,
      cellPx,
    },
    viewport,
  );
}

export function cameraForWholeWorld(viewport: Viewport): Camera {
  const fitted = Math.min(
    viewport.width / WORLD_WIDTH,
    viewport.height / WORLD_HEIGHT,
  );
  return clampCamera(
    {
      centerX: WORLD_WIDTH / 2,
      centerY: WORLD_HEIGHT / 2,
      cellPx: fitted,
    },
    viewport,
  );
}

export function cameraForCoordinate(x: number, y: number, cellPx = 80): Camera {
  return {
    centerX: x + 0.5,
    centerY: y + 0.5,
    cellPx: clampCellPx(cellPx),
  };
}

export function densityForCellPx(cellPx: number): MapDensity {
  if (cellPx < 4) return "overview-100";
  if (cellPx < DETAIL_CELL_PX) return "overview-20";
  return "individual";
}

export function visibleChunks(
  camera: Camera,
  viewport: Viewport,
  prefetchChunks = 1,
): ChunkCoordinate[] | null {
  if (densityForCellPx(camera.cellPx) !== "individual") return [];

  const halfWidth = viewport.width / (2 * camera.cellPx);
  const halfHeight = viewport.height / (2 * camera.cellPx);
  const visibleMinCx = clampInt(
    Math.floor((camera.centerX - halfWidth) / CHUNK_SIZE),
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const visibleMaxCx = clampInt(
    Math.ceil((camera.centerX + halfWidth) / CHUNK_SIZE) - 1,
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const visibleMinCy = clampInt(
    Math.floor((camera.centerY - halfHeight) / CHUNK_SIZE),
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const visibleMaxCy = clampInt(
    Math.ceil((camera.centerY + halfHeight) / CHUNK_SIZE) - 1,
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const minCx = clampInt(
    visibleMinCx - prefetchChunks,
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const maxCx = clampInt(
    visibleMaxCx + prefetchChunks,
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const minCy = clampInt(
    visibleMinCy - prefetchChunks,
    0,
    CHUNK_AXIS_COUNT - 1,
  );
  const maxCy = clampInt(
    visibleMaxCy + prefetchChunks,
    0,
    CHUNK_AXIS_COUNT - 1,
  );

  const count = (maxCx - minCx + 1) * (maxCy - minCy + 1);
  if (count > MAX_VISIBLE_CHUNKS) return null;

  const result: ChunkCoordinate[] = [];
  for (let cy = minCy; cy <= maxCy; cy += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      result.push({ cx, cy });
    }
  }
  const centerCx = camera.centerX / CHUNK_SIZE - 0.5;
  const centerCy = camera.centerY / CHUNK_SIZE - 0.5;
  return result.sort((first, second) => {
    const firstVisible =
      first.cx >= visibleMinCx &&
      first.cx <= visibleMaxCx &&
      first.cy >= visibleMinCy &&
      first.cy <= visibleMaxCy;
    const secondVisible =
      second.cx >= visibleMinCx &&
      second.cx <= visibleMaxCx &&
      second.cy >= visibleMinCy &&
      second.cy <= visibleMaxCy;
    if (firstVisible !== secondVisible) return firstVisible ? -1 : 1;
    const firstDistance =
      (first.cx - centerCx) ** 2 + (first.cy - centerCy) ** 2;
    const secondDistance =
      (second.cx - centerCx) ** 2 + (second.cy - centerCy) ** 2;
    return (
      firstDistance - secondDistance ||
      first.cy - second.cy ||
      first.cx - second.cx
    );
  });
}

export function isTapDistance(start: CanvasPoint, end: CanvasPoint): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) <= DRAG_THRESHOLD_PX;
}

export function parseLocationCamera(search: string): Camera | null {
  const query = new URLSearchParams(search);
  const x = parseInteger(query.get("x"));
  const y = parseInteger(query.get("y"));
  if (
    x === null ||
    y === null ||
    x < 0 ||
    x >= WORLD_WIDTH ||
    y < 0 ||
    y >= WORLD_HEIGHT
  ) {
    return null;
  }
  const rawZoom = query.get("z");
  const parsedZoom = rawZoom === null ? 64 : Number(rawZoom);
  if (!Number.isFinite(parsedZoom)) return null;
  return cameraForCoordinate(x, y, clampCellPx(parsedZoom));
}

export function parseStoredCamera(value: string | null): Camera | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Camera>;
    if (
      !Number.isFinite(parsed.centerX) ||
      !Number.isFinite(parsed.centerY) ||
      !Number.isFinite(parsed.cellPx) ||
      parsed.centerX! < 0 ||
      parsed.centerX! > WORLD_WIDTH ||
      parsed.centerY! < 0 ||
      parsed.centerY! > WORLD_HEIGHT
    ) {
      return null;
    }
    return {
      centerX: parsed.centerX!,
      centerY: parsed.centerY!,
      cellPx: clampCellPx(parsed.cellPx!),
    };
  } catch {
    return null;
  }
}

export function serializeCamera(camera: Camera): string {
  return JSON.stringify({
    centerX: camera.centerX,
    centerY: camera.centerY,
    cellPx: camera.cellPx,
  });
}

export function cameraSearchParams(
  currentSearch: string,
  camera: Camera,
): string {
  const query = new URLSearchParams(currentSearch);
  query.set(
    "x",
    String(clampInt(Math.round(camera.centerX - 0.5), 0, WORLD_WIDTH - 1)),
  );
  query.set(
    "y",
    String(clampInt(Math.round(camera.centerY - 0.5), 0, WORLD_HEIGHT - 1)),
  );
  query.set("z", String(Number(camera.cellPx.toFixed(2))));
  return query.toString();
}

export function worldLocationHref(
  worldSlug: string,
  x: number,
  y: number,
  cellPx = MESSAGE_CELL_PX,
): string {
  const search = cameraSearchParams("", cameraForCoordinate(x, y, cellPx));
  return `/w/${encodeURIComponent(worldSlug)}?${search}`;
}

/** Centers an invite pair and uses a scale that keeps a radius-20 nearby
 * result visible even in a 320px-wide map viewport. */
export function worldPairLocationHref(
  worldSlug: string,
  first: WorldPoint,
  second: WorldPoint,
): string {
  const midpoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
  return worldLocationHref(worldSlug, midpoint.x, midpoint.y, 8);
}

export function chooseInitialOverviewCamera(
  response: OverviewResponse,
): Camera | null {
  let candidate: OverviewCell | null = null;
  const capacity = response.cellSize * response.cellSize;
  for (const cell of response.cells) {
    if (cell.listedCount === 0) continue;
    const hasAvailability = cell.occupiedCount < capacity;
    const candidateHasAvailability =
      candidate !== null && candidate.occupiedCount < capacity;
    if (
      candidate === null ||
      (hasAvailability && !candidateHasAvailability) ||
      (hasAvailability === candidateHasAvailability &&
        cell.listedCount > candidate.listedCount) ||
      (hasAvailability === candidateHasAvailability &&
        cell.listedCount === candidate.listedCount &&
        cell.occupiedCount < candidate.occupiedCount) ||
      (hasAvailability === candidateHasAvailability &&
        cell.listedCount === candidate.listedCount &&
        cell.occupiedCount === candidate.occupiedCount &&
        cell.y * WORLD_WIDTH + cell.x < candidate.y * WORLD_WIDTH + candidate.x)
    ) {
      candidate = cell;
    }
  }
  if (!candidate) return null;
  return {
    centerX: candidate.x + response.cellSize / 2,
    centerY: candidate.y + response.cellSize / 2,
    cellPx: 64,
  };
}

export function chunkKey(chunk: ChunkCoordinate): string {
  return `${chunk.cx}:${chunk.cy}`;
}

export function pruneMapCache<T>(
  cache: Map<string, T>,
  protectedKeys: ReadonlySet<string>,
  maximum = MAX_CACHED_CHUNKS,
): string[] {
  const removed: string[] = [];
  for (const key of cache.keys()) {
    if (cache.size <= maximum) break;
    if (protectedKeys.has(key)) continue;
    cache.delete(key);
    removed.push(key);
  }
  return removed;
}

export function createPublicEmaPage(
  incoming: readonly PublicEma[],
  currentPageCursor: string | null,
  nextCursor: string | null,
  pageNumber: number,
): PublicEmaPage {
  const deduplicated = new Map<string, PublicEma>();
  for (const item of incoming) {
    deduplicated.set(item.publicId, item);
  }
  return {
    items: [...deduplicated.values()].slice(0, PUBLIC_FEED_PAGE_SIZE),
    pageNumber: Math.max(1, Math.trunc(pageNumber)),
    currentPageCursor,
    nextCursor,
  };
}

function parseInteger(value: string | null): number | null {
  if (value === null || !/^-?\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.trunc(clamp(value, minimum, maximum));
}
