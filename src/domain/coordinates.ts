import { z } from "zod";

import {
  CHUNK_AXIS_COUNT,
  CHUNK_SIZE,
  WORLD_HEIGHT,
  WORLD_SLOT_COUNT,
  WORLD_WIDTH,
} from "./constants";

export const xCoordinateSchema = z
  .number()
  .int()
  .min(0)
  .max(WORLD_WIDTH - 1);
export const yCoordinateSchema = z
  .number()
  .int()
  .min(0)
  .max(WORLD_HEIGHT - 1);
export const slotNumberSchema = z.number().int().min(1).max(WORLD_SLOT_COUNT);
export const chunkCoordinateSchema = z
  .number()
  .int()
  .min(0)
  .max(CHUNK_AXIS_COUNT - 1);

export const coordinateSchema = z
  .object({
    x: xCoordinateSchema,
    y: yCoordinateSchema,
  })
  .strict();

export type Coordinate = z.infer<typeof coordinateSchema>;

export const chunkCoordinatesSchema = z
  .object({
    cx: chunkCoordinateSchema,
    cy: chunkCoordinateSchema,
  })
  .strict();

export type ChunkCoordinates = z.infer<typeof chunkCoordinatesSchema>;

export function toSlotNumber(x: number, y: number): number {
  const coordinate = coordinateSchema.parse({ x, y });
  return coordinate.y * WORLD_WIDTH + coordinate.x + 1;
}

export function fromSlotNumber(slotNumber: number): Coordinate {
  const slot = slotNumberSchema.parse(slotNumber);
  const zeroBased = slot - 1;
  return {
    x: zeroBased % WORLD_WIDTH,
    y: Math.floor(zeroBased / WORLD_WIDTH),
  };
}

export function toChunkCoordinates(x: number, y: number): ChunkCoordinates {
  const coordinate = coordinateSchema.parse({ x, y });
  return {
    cx: Math.floor(coordinate.x / CHUNK_SIZE),
    cy: Math.floor(coordinate.y / CHUNK_SIZE),
  };
}

export function isCoordinateInChunk(
  coordinate: Coordinate,
  chunk: ChunkCoordinates,
): boolean {
  return (
    Math.floor(coordinate.x / CHUNK_SIZE) === chunk.cx &&
    Math.floor(coordinate.y / CHUNK_SIZE) === chunk.cy
  );
}
