import { z } from "zod";

import {
  API_ERROR_CODE_VALUES,
  CATEGORY_VALUES,
  CHUNK_CELL_LIMIT,
  DESIGN_VALUES,
  EMA_STATUS_VALUES,
  MESSAGE_VISIBILITY_VALUES,
  OVERVIEW_CELL_LIMIT,
  OVERVIEW_CELL_SIZE_VALUES,
  OWNER_EMA_STATUS_VALUES,
  REPORT_REASON_VALUES,
  VISIBILITY_VALUES,
  WORLD_HEIGHT,
  WORLD_SLOT_COUNT,
  WORLD_STATE_VALUES,
  WORLD_WIDTH,
} from "./constants";
import {
  chunkCoordinateSchema,
  isCoordinateInChunk,
  slotNumberSchema,
  toSlotNumber,
  xCoordinateSchema,
  yCoordinateSchema,
} from "./coordinates";
import {
  nicknameSchema,
  reportDetailSchema,
  safeDisplayTextSchema,
  wishTextSchema,
} from "./text";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UTC_ISO_8601_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u;
const UTC_CALENDAR_DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T/u;

function isExistingUtcCalendarDate(value: string): boolean {
  const match = UTC_CALENDAR_DATE_PREFIX_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;

  const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= (daysInMonth[month - 1] ?? 0);
}

export const categorySchema = z.enum(CATEGORY_VALUES);
export const visibilitySchema = z.enum(VISIBILITY_VALUES);
export const messageVisibilitySchema = z.enum(MESSAGE_VISIBILITY_VALUES);
export const emaStatusSchema = z.enum(EMA_STATUS_VALUES);
export const ownerEmaStatusSchema = z.enum(OWNER_EMA_STATUS_VALUES);
export const worldStateSchema = z.enum(WORLD_STATE_VALUES);
export const designIdSchema = z.enum(DESIGN_VALUES);
export const reportReasonSchema = z.enum(REPORT_REASON_VALUES);
export const apiErrorCodeSchema = z.enum(API_ERROR_CODE_VALUES);

export const uuidV4Schema = z
  .string()
  .regex(UUID_V4_PATTERN, "UUID v4を指定してください");
export const publicIdSchema = uuidV4Schema;
export const idempotencyKeySchema = uuidV4Schema;

export const worldSlugSchema = z
  .string()
  .regex(/^\d{4}$/u, "worldSlugは4桁の年度で指定してください");

export const utcIsoDateTimeSchema = z
  .string()
  .regex(UTC_ISO_8601_PATTERN, "UTCのISO 8601形式で指定してください")
  .refine(isExistingUtcCalendarDate, "有効な日時を指定してください");

export const versionSchema = z.number().int().min(1);
export const revisionSchema = z.number().int().nonnegative();
export const overviewCellSizeSchema = z.union([
  z.literal(OVERVIEW_CELL_SIZE_VALUES[0]),
  z.literal(OVERVIEW_CELL_SIZE_VALUES[1]),
]);

export const capabilitiesSchema = z
  .object({
    groups: z.boolean(),
    fulfillment: z.boolean(),
    payments: z.boolean(),
  })
  .strict();

export const worldSchema = z
  .object({
    slug: worldSlugSchema,
    name: safeDisplayTextSchema.pipe(z.string().min(1).max(100)),
    state: worldStateSchema,
    width: z.literal(WORLD_WIDTH),
    height: z.literal(WORLD_HEIGHT),
    opensAt: utcIsoDateTimeSchema,
    closesAt: utcIsoDateTimeSchema,
    acceptingPosts: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.opensAt) >= Date.parse(value.closesAt)) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "受付終了は受付開始より後にしてください",
      });
    }
  });

export const worldStatsSchema = z
  .object({
    occupiedCount: z.number().int().min(0).max(WORLD_SLOT_COUNT),
    activeCount: z.number().int().min(0).max(WORLD_SLOT_COUNT),
    listedCount: z.number().int().min(0).max(WORLD_SLOT_COUNT),
    asOf: utcIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.listedCount > value.activeCount ||
      value.activeCount > value.occupiedCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "集計値は listedCount <= activeCount <= occupiedCount を満たす必要があります",
      });
    }
  });

export const worldResponseSchema = z
  .object({
    world: worldSchema,
    serverTime: utcIsoDateTimeSchema,
    stats: worldStatsSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();

export const overviewCellSchema = z
  .object({
    x: xCoordinateSchema,
    y: yCoordinateSchema,
    occupiedCount: z.number().int().min(1).max(10_000),
    activeCount: z.number().int().min(0).max(10_000),
    listedCount: z.number().int().min(0).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.listedCount > value.activeCount ||
      value.activeCount > value.occupiedCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "集計値は listedCount <= activeCount <= occupiedCount を満たす必要があります",
      });
    }
  });

export const overviewResponseSchema = z
  .object({
    cellSize: overviewCellSizeSchema,
    cells: z.array(overviewCellSchema).max(OVERVIEW_CELL_LIMIT),
    asOf: utcIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    const maxCount = value.cellSize * value.cellSize;
    const maxCells =
      (WORLD_WIDTH / value.cellSize) * (WORLD_HEIGHT / value.cellSize);
    if (value.cells.length > maxCells) {
      context.addIssue({
        code: "custom",
        path: ["cells"],
        message: "集計セル数がcellSizeごとの上限を超えています",
      });
    }
    for (const [index, cell] of value.cells.entries()) {
      if (
        cell.x % value.cellSize !== 0 ||
        cell.y % value.cellSize !== 0 ||
        cell.x + value.cellSize > WORLD_WIDTH ||
        cell.y + value.cellSize > WORLD_HEIGHT
      ) {
        context.addIssue({
          code: "custom",
          path: ["cells", index],
          message: "集計セルの位置がcellSizeと一致しません",
        });
      }
      if (cell.occupiedCount > maxCount) {
        context.addIssue({
          code: "custom",
          path: ["cells", index, "occupiedCount"],
          message: "集計セルの最大枠数を超えています",
        });
      }
      const key = `${cell.x}:${cell.y}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["cells", index],
          message: "同じ集計セルが重複しています",
        });
      }
      seen.add(key);
    }
  });

const publicEmaShape = {
  publicId: publicIdSchema,
  worldSlug: worldSlugSchema,
  x: xCoordinateSchema,
  y: yCoordinateSchema,
  slotNumber: slotNumberSchema,
  nickname: nicknameSchema,
  category: categorySchema,
  designId: designIdSchema,
  visibility: visibilitySchema,
  messageVisibility: messageVisibilitySchema,
  messageText: wishTextSchema.nullable(),
  version: versionSchema,
  createdAt: utcIsoDateTimeSchema,
  updatedAt: utcIsoDateTimeSchema,
} as const;

export const publicEmaSchema = z
  .object(publicEmaShape)
  .strict()
  .superRefine((value, context) => {
    if (value.slotNumber !== toSlotNumber(value.x, value.y)) {
      context.addIssue({
        code: "custom",
        path: ["slotNumber"],
        message: "座標と表示番号が一致しません",
      });
    }
    if (
      value.messageVisibility === "owner_only" &&
      value.messageText !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["messageText"],
        message: "本人だけの本文を公開DTOへ含めることはできません",
      });
    }
    if (value.messageVisibility === "public" && value.messageText === null) {
      context.addIssue({
        code: "custom",
        path: ["messageText"],
        message: "公開本文がありません",
      });
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "更新日時が作成日時より前です",
      });
    }
  });

export const listedPublicEmaSchema = publicEmaSchema.refine(
  (value) => value.visibility === "public",
  {
    path: ["visibility"],
    message: "URL限定の絵馬を公開探索へ含めることはできません",
  },
);

const publicFeedCursorSchema = z
  .string()
  .min(1)
  .max(768)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const publicEmaListResponseSchema = z
  .object({
    items: z.array(listedPublicEmaSchema).max(50),
    nextCursor: publicFeedCursorSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.publicId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "publicId"],
          message: "同じ絵馬が重複しています",
        });
      }
      seen.add(item.publicId);
    }
  });

export const randomEmaResponseSchema = z
  .object({ item: listedPublicEmaSchema.nullable() })
  .strict();

export const ownerEmaCapabilitiesSchema = z
  .object({
    editContent: z.boolean(),
    visibilityMode: z.enum(["all", "restrict_only", "none"]),
    delete: z.boolean(),
  })
  .strict();

export const ownerEmaSchema = z
  .object({
    publicId: publicIdSchema,
    worldSlug: worldSlugSchema,
    x: xCoordinateSchema,
    y: yCoordinateSchema,
    slotNumber: slotNumberSchema,
    nickname: nicknameSchema,
    category: categorySchema,
    designId: designIdSchema,
    visibility: visibilitySchema,
    messageVisibility: messageVisibilitySchema,
    wishText: wishTextSchema,
    status: ownerEmaStatusSchema,
    version: versionSchema,
    createdAt: utcIsoDateTimeSchema,
    updatedAt: utcIsoDateTimeSchema,
    capabilities: ownerEmaCapabilitiesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.slotNumber !== toSlotNumber(value.x, value.y)) {
      context.addIssue({
        code: "custom",
        path: ["slotNumber"],
        message: "座標と表示番号が一致しません",
      });
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "更新日時が作成日時より前です",
      });
    }
  });

export const occupiedChunkCellSchema = z
  .object({
    kind: z.literal("occupied"),
    x: xCoordinateSchema,
    y: yCoordinateSchema,
    slotNumber: slotNumberSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.slotNumber !== toSlotNumber(value.x, value.y)) {
      context.addIssue({
        code: "custom",
        path: ["slotNumber"],
        message: "座標と表示番号が一致しません",
      });
    }
  });

export const publicChunkCellSchema = z
  .object({
    kind: z.literal("public"),
    ema: publicEmaSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ema.visibility !== "public") {
      context.addIssue({
        code: "custom",
        path: ["ema", "visibility"],
        message: "URL限定の絵馬をチャンクへ含めることはできません",
      });
    }
  });

export const chunkCellSchema = z.union([
  publicChunkCellSchema,
  occupiedChunkCellSchema,
]);

export const chunkResponseSchema = z
  .object({
    worldSlug: worldSlugSchema,
    cx: chunkCoordinateSchema,
    cy: chunkCoordinateSchema,
    revision: revisionSchema,
    cells: z.array(chunkCellSchema).max(CHUNK_CELL_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    const seenSlots = new Set<number>();
    for (const [index, cell] of value.cells.entries()) {
      const coordinate =
        cell.kind === "public"
          ? { x: cell.ema.x, y: cell.ema.y }
          : { x: cell.x, y: cell.y };
      const slotNumber =
        cell.kind === "public" ? cell.ema.slotNumber : cell.slotNumber;

      if (!isCoordinateInChunk(coordinate, { cx: value.cx, cy: value.cy })) {
        context.addIssue({
          code: "custom",
          path: ["cells", index],
          message: "指定チャンク外の座標です",
        });
      }
      if (seenSlots.has(slotNumber)) {
        context.addIssue({
          code: "custom",
          path: ["cells", index],
          message: "同じ場所が重複しています",
        });
      }
      seenSlots.add(slotNumber);
    }
  });

export const createEmaInputSchema = z
  .object({
    x: xCoordinateSchema,
    y: yCoordinateSchema,
    wishText: wishTextSchema,
    nickname: nicknameSchema.optional(),
    category: categorySchema,
    designId: designIdSchema,
    visibility: visibilitySchema,
    messageVisibility: messageVisibilitySchema,
  })
  .strict();

export const updateEmaInputSchema = z
  .object({
    expectedVersion: versionSchema,
    wishText: wishTextSchema.optional(),
    nickname: nicknameSchema.optional(),
    category: categorySchema.optional(),
    designId: designIdSchema.optional(),
    visibility: visibilitySchema.optional(),
    messageVisibility: messageVisibilitySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).every((key) => key === "expectedVersion")) {
      context.addIssue({
        code: "custom",
        message: "更新する項目を1つ以上指定してください",
      });
    }
  });

export const deleteEmaInputSchema = z
  .object({
    expectedVersion: versionSchema,
  })
  .strict();

export const createReportInputSchema = z
  .object({
    reason: reportReasonSchema,
    detail: reportDetailSchema.optional(),
  })
  .strict();

export const nearbyQuerySchema = z
  .object({
    near: publicIdSchema.optional(),
    x: xCoordinateSchema.optional(),
    y: yCoordinateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const usesNear = value.near !== undefined;
    const usesCoordinate = value.x !== undefined || value.y !== undefined;
    if (usesNear === usesCoordinate) {
      context.addIssue({
        code: "custom",
        message: "nearまたはx/yのどちらか一方を指定してください",
      });
    }
    if (usesCoordinate && (value.x === undefined || value.y === undefined)) {
      context.addIssue({
        code: "custom",
        message: "xとyを両方指定してください",
      });
    }
  });

export const nearbyCandidateSchema = z
  .object({
    x: xCoordinateSchema,
    y: yCoordinateSchema,
    slotNumber: slotNumberSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.slotNumber !== toSlotNumber(value.x, value.y)) {
      context.addIssue({
        code: "custom",
        path: ["slotNumber"],
        message: "座標と表示番号が一致しません",
      });
    }
  });

export const nearbyResponseSchema = z
  .object({
    origin: z.object({ x: xCoordinateSchema, y: yCoordinateSchema }).strict(),
    candidates: z.array(nearbyCandidateSchema).max(8),
    searchedRadius: z.union([z.literal(3), z.literal(8), z.literal(20)]),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<number>();
    let previous: { distanceSquared: number; slotNumber: number } | undefined;

    for (const [index, candidate] of value.candidates.entries()) {
      const dx = candidate.x - value.origin.x;
      const dy = candidate.y - value.origin.y;
      const chebyshevDistance = Math.max(Math.abs(dx), Math.abs(dy));
      const distanceSquared = dx * dx + dy * dy;

      if (chebyshevDistance > value.searchedRadius) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index],
          message: "探索半径外の候補です",
        });
      }
      if (seen.has(candidate.slotNumber)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index],
          message: "同じ候補が重複しています",
        });
      }
      if (
        previous &&
        (distanceSquared < previous.distanceSquared ||
          (distanceSquared === previous.distanceSquared &&
            candidate.slotNumber < previous.slotNumber))
      ) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index],
          message: "候補の並び順が正しくありません",
        });
      }

      seen.add(candidate.slotNumber);
      previous = { distanceSquared, slotNumber: candidate.slotNumber };
    }
  });

export const ownerWorldSummarySchema = z
  .object({
    worldSlug: worldSlugSchema,
    worldName: safeDisplayTextSchema.pipe(z.string().min(1).max(100)),
    worldState: worldStateSchema,
    ema: z
      .object({
        publicId: publicIdSchema,
        slotNumber: slotNumberSchema,
        status: ownerEmaStatusSchema,
        designId: designIdSchema,
        visibility: visibilitySchema,
        messageVisibility: messageVisibilitySchema,
        version: versionSchema,
        updatedAt: utcIsoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const mutationReceiptSchema = z
  .object({
    publicId: publicIdSchema,
    worldSlug: worldSlugSchema,
    version: versionSchema,
    result: z.enum(["created", "updated", "deleted"]),
    canonicalUrl: z.string(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedUrl = `/w/${value.worldSlug}/e/${value.publicId}`;
    if (value.canonicalUrl !== expectedUrl) {
      context.addIssue({
        code: "custom",
        path: ["canonicalUrl"],
        message: "正規URLがpublicIdとworldSlugに一致しません",
      });
    }
  });

export const reportReceiptSchema = z
  .object({
    reportId: uuidV4Schema,
    accepted: z.literal(true),
  })
  .strict();

export const reportMutationReceiptSchema = z
  .object({
    reportId: uuidV4Schema,
    state: z.enum(["resolved", "dismissed"]),
    version: versionSchema,
  })
  .strict();

const apiErrorDetailSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: safeDisplayTextSchema.pipe(z.string().min(1).max(500)),
    requestId: safeDisplayTextSchema.pipe(z.string().min(1).max(128)),
    fieldErrors: z.record(z.string(), z.string()).optional(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    error: apiErrorDetailSchema,
  })
  .strict();

export type Category = z.infer<typeof categorySchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type MessageVisibility = z.infer<typeof messageVisibilitySchema>;
export type EmaStatus = z.infer<typeof emaStatusSchema>;
export type OwnerEmaStatus = z.infer<typeof ownerEmaStatusSchema>;
export type WorldState = z.infer<typeof worldStateSchema>;
export type DesignId = z.infer<typeof designIdSchema>;
export type ReportReason = z.infer<typeof reportReasonSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type World = z.infer<typeof worldSchema>;
export type WorldStats = z.infer<typeof worldStatsSchema>;
export type WorldResponse = z.infer<typeof worldResponseSchema>;
export type OverviewCellSize = z.infer<typeof overviewCellSizeSchema>;
export type OverviewCell = z.infer<typeof overviewCellSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type PublicEma = z.infer<typeof publicEmaSchema>;
export type ListedPublicEma = z.infer<typeof listedPublicEmaSchema>;
export type PublicEmaListResponse = z.infer<typeof publicEmaListResponseSchema>;
export type RandomEmaResponse = z.infer<typeof randomEmaResponseSchema>;
export type OwnerEma = z.infer<typeof ownerEmaSchema>;
export type ChunkCell = z.infer<typeof chunkCellSchema>;
export type ChunkResponse = z.infer<typeof chunkResponseSchema>;
export type CreateEmaInput = z.infer<typeof createEmaInputSchema>;
export type UpdateEmaInput = z.infer<typeof updateEmaInputSchema>;
export type DeleteEmaInput = z.infer<typeof deleteEmaInputSchema>;
export type CreateReportInput = z.infer<typeof createReportInputSchema>;
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
export type NearbyCandidate = z.infer<typeof nearbyCandidateSchema>;
export type NearbyResponse = z.infer<typeof nearbyResponseSchema>;
export type OwnerWorldSummary = z.infer<typeof ownerWorldSummarySchema>;
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
export type ReportReceipt = z.infer<typeof reportReceiptSchema>;
export type ReportMutationReceipt = z.infer<typeof reportMutationReceiptSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
