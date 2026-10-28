import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/domain/constants";
import type { ChunkResponse, PublicEma } from "@/domain/schemas";

import {
  MESSAGE_CELL_PX,
  canvasPointFromWorld,
  chunkKey,
  type Camera,
  type ChunkCoordinate,
  type MapDensity,
  type OverviewResponse,
  type Viewport,
} from "./map-contracts";

export type MapSelection = { x: number; y: number } | null;

export type MapRenderInput = {
  context: CanvasRenderingContext2D;
  viewport: Viewport;
  camera: Camera;
  density: MapDensity;
  overview: OverviewResponse | null;
  visibleChunkCoordinates: ChunkCoordinate[] | null;
  chunks: ReadonlyMap<string, ChunkResponse>;
  selection: MapSelection;
};

export function drawWorldMap(input: MapRenderInput): void {
  const {
    context,
    viewport,
    camera,
    density,
    overview,
    visibleChunkCoordinates,
    chunks,
    selection,
  } = input;
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = "#f3ead8";
  context.fillRect(0, 0, viewport.width, viewport.height);

  drawWorldBoundary(context, camera, viewport);
  if (density === "individual" && visibleChunkCoordinates !== null) {
    drawIndividualMap(
      context,
      camera,
      viewport,
      visibleChunkCoordinates,
      chunks,
    );
  } else {
    drawOverview(context, camera, viewport, overview);
  }
  if (selection) drawSelection(context, camera, viewport, selection);
}

function drawWorldBoundary(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
): void {
  const topLeft = canvasPointFromWorld({ x: 0, y: 0 }, camera, viewport);
  const bottomRight = canvasPointFromWorld(
    { x: WORLD_WIDTH, y: WORLD_HEIGHT },
    camera,
    viewport,
  );
  context.save();
  context.fillStyle = "#ead9bc";
  context.fillRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  context.strokeStyle = "#8f7658";
  context.lineWidth = 2;
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  context.restore();
}

function drawOverview(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  overview: OverviewResponse | null,
): void {
  if (!overview) {
    context.save();
    context.fillStyle = "rgb(109 59 46 / 12%)";
    context.fillRect(0, 0, viewport.width, viewport.height);
    context.restore();
    return;
  }

  const capacity = overview.cellSize * overview.cellSize;
  for (const cell of overview.cells) {
    if (cell.occupiedCount === 0) continue;
    const topLeft = canvasPointFromWorld(
      { x: cell.x, y: cell.y },
      camera,
      viewport,
    );
    const size = overview.cellSize * camera.cellPx;
    if (
      topLeft.x > viewport.width ||
      topLeft.y > viewport.height ||
      topLeft.x + size < 0 ||
      topLeft.y + size < 0
    ) {
      continue;
    }
    const density = Math.min(1, cell.occupiedCount / capacity);
    context.fillStyle = `rgb(109 59 46 / ${String(0.2 + density * 0.65)})`;
    context.fillRect(
      topLeft.x,
      topLeft.y,
      Math.max(1, size),
      Math.max(1, size),
    );
    if (size >= 38) {
      context.fillStyle = "#fffdf8";
      context.font = "700 12px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        `${cell.occupiedCount}か所`,
        topLeft.x + size / 2,
        topLeft.y + size / 2,
        Math.max(1, size - 8),
      );
    }
  }
}

function drawIndividualMap(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  visibleChunkCoordinates: ChunkCoordinate[],
  chunks: ReadonlyMap<string, ChunkResponse>,
): void {
  drawGrid(context, camera, viewport);
  for (const chunk of visibleChunkCoordinates) {
    const response = chunks.get(chunkKey(chunk));
    if (!response) {
      drawUnknownChunk(context, camera, viewport, chunk);
      continue;
    }
    for (const cell of response.cells) {
      if (cell.kind === "occupied") {
        drawOccupiedCell(context, camera, viewport, cell.x, cell.y);
      } else {
        drawPublicEma(context, camera, viewport, cell.ema);
      }
    }
  }
}

function drawGrid(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
): void {
  const halfWidth = viewport.width / (2 * camera.cellPx);
  const halfHeight = viewport.height / (2 * camera.cellPx);
  const minX = Math.max(0, Math.floor(camera.centerX - halfWidth));
  const maxX = Math.min(WORLD_WIDTH, Math.ceil(camera.centerX + halfWidth));
  const minY = Math.max(0, Math.floor(camera.centerY - halfHeight));
  const maxY = Math.min(WORLD_HEIGHT, Math.ceil(camera.centerY + halfHeight));
  context.save();
  context.beginPath();
  context.strokeStyle = "rgb(109 59 46 / 16%)";
  context.lineWidth = 1;
  for (let x = minX; x <= maxX; x += 1) {
    const point = canvasPointFromWorld({ x, y: minY }, camera, viewport);
    context.moveTo(Math.round(point.x) + 0.5, 0);
    context.lineTo(Math.round(point.x) + 0.5, viewport.height);
  }
  for (let y = minY; y <= maxY; y += 1) {
    const point = canvasPointFromWorld({ x: minX, y }, camera, viewport);
    context.moveTo(0, Math.round(point.y) + 0.5);
    context.lineTo(viewport.width, Math.round(point.y) + 0.5);
  }
  context.stroke();
  context.restore();
}

function drawUnknownChunk(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  chunk: ChunkCoordinate,
): void {
  const topLeft = canvasPointFromWorld(
    { x: chunk.cx * CHUNK_SIZE, y: chunk.cy * CHUNK_SIZE },
    camera,
    viewport,
  );
  const size = CHUNK_SIZE * camera.cellPx;
  context.save();
  context.fillStyle = "rgb(255 253 248 / 62%)";
  context.fillRect(topLeft.x, topLeft.y, size, size);
  context.strokeStyle = "rgb(102 93 83 / 28%)";
  context.setLineDash([5, 5]);
  context.strokeRect(topLeft.x, topLeft.y, size, size);
  context.restore();
}

function drawOccupiedCell(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  x: number,
  y: number,
): void {
  const topLeft = canvasPointFromWorld({ x, y }, camera, viewport);
  const inset = Math.max(2, camera.cellPx * 0.16);
  const width = Math.max(3, camera.cellPx - inset * 2);
  context.save();
  context.fillStyle = "#8a837a";
  context.fillRect(topLeft.x + inset, topLeft.y + inset, width, width);
  context.fillStyle = "#fffdf8";
  context.font = `700 ${String(Math.max(9, Math.min(14, camera.cellPx * 0.22)))}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (camera.cellPx >= 48) {
    context.fillText(
      "使用中",
      topLeft.x + camera.cellPx / 2,
      topLeft.y + camera.cellPx / 2,
      Math.max(1, width - 4),
    );
  }
  context.restore();
}

function drawPublicEma(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  ema: PublicEma,
): void {
  const topLeft = canvasPointFromWorld(
    { x: ema.x, y: ema.y },
    camera,
    viewport,
  );
  const inset = Math.max(2, camera.cellPx * 0.1);
  const left = topLeft.x + inset;
  const top = topLeft.y + inset;
  const width = Math.max(4, camera.cellPx - inset * 2);
  const height = width;
  context.save();
  context.beginPath();
  context.moveTo(left + width * 0.18, top);
  context.lineTo(left + width * 0.82, top);
  context.lineTo(left + width, top + height * 0.2);
  context.lineTo(left + width * 0.92, top + height);
  context.lineTo(left + width * 0.08, top + height);
  context.lineTo(left, top + height * 0.2);
  context.closePath();
  context.fillStyle = "#d9ae6c";
  context.fill();
  context.strokeStyle = "#8d693c";
  context.lineWidth = Math.max(1, camera.cellPx * 0.025);
  context.stroke();

  if (camera.cellPx >= MESSAGE_CELL_PX) {
    const label = ema.messageText ?? "ひみつの願い";
    context.fillStyle = "#3f3023";
    context.font = `700 ${String(Math.max(10, Math.min(15, camera.cellPx * 0.16)))}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      truncateText(label, 12),
      topLeft.x + camera.cellPx / 2,
      topLeft.y + camera.cellPx / 2,
      Math.max(1, width * 0.78),
    );
  }
  context.restore();
}

function drawSelection(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  selection: NonNullable<MapSelection>,
): void {
  const topLeft = canvasPointFromWorld(selection, camera, viewport);
  context.save();
  context.strokeStyle = "#1f6694";
  context.lineWidth = 4;
  context.strokeRect(
    topLeft.x + 2,
    topLeft.y + 2,
    Math.max(1, camera.cellPx - 4),
    Math.max(1, camera.cellPx - 4),
  );
  context.restore();
}

function truncateText(value: string, limit: number): string {
  const characters = Array.from(value.replace(/\s+/gu, " "));
  return characters.length <= limit
    ? characters.join("")
    : `${characters.slice(0, limit).join("")}…`;
}
