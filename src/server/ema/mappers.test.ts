import { describe, expect, it } from "vitest";

import {
  mapCreateEmaRow,
  mapListedPublicEmaRow,
  mapMutationEmaRow,
  mapOwnerEmaRow,
  mapOwnerWorldRow,
  mapPublicChunkRows,
  mapPublicEmaRow,
  mapPublicOverviewRows,
  mapPublicWorldRow,
} from "@/server/ema/mappers";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECRET_WISH = "この本文は本人だけが読める秘密の願い";

const publicRow = {
  public_id: PUBLIC_ID,
  world_slug: "2027",
  x: 2,
  y: 3,
  slot_number: 3003,
  nickname: "えま太郎",
  category: "health",
  design_id: "basic_wood",
  visibility: "unlisted",
  message_visibility: "owner_only",
  message_text: null,
  version: 1,
  created_at: new Date("2026-12-19T15:00:00Z"),
  updated_at: new Date("2026-12-20T00:00:00Z"),
};

describe("database DTO mappers", () => {
  it("keeps owner-only content out of the public DTO", () => {
    const ema = mapPublicEmaRow(publicRow);

    expect(ema.messageText).toBeNull();
    expect(ema).not.toHaveProperty("wishText");
    expect(JSON.stringify(ema)).not.toContain(SECRET_WISH);
  });

  it("rejects a projection that contains owner-only content", () => {
    expect(() =>
      mapPublicEmaRow({ ...publicRow, message_text: SECRET_WISH }),
    ).toThrow();
  });

  it("rejects unlisted rows from enumerable feed and random projections", () => {
    expect(() => mapListedPublicEmaRow(publicRow)).toThrow();
    expect(
      mapListedPublicEmaRow({ ...publicRow, visibility: "public" }).visibility,
    ).toBe("public");
  });

  it("maps an empty overview with the world timestamp and no invented cells", () => {
    expect(
      mapPublicOverviewRows(
        [
          {
            meta_world_slug: "2027",
            meta_as_of: "2026-12-20T00:00:00Z",
            cell_world_slug: null,
            cell_size: null,
            x: null,
            y: null,
            occupied_count: null,
            active_count: null,
            listed_count: null,
            cell_as_of: null,
          },
        ],
        20,
      ),
    ).toEqual({
      cellSize: 20,
      cells: [],
      asOf: "2026-12-20T00:00:00.000Z",
    });
    expect(mapPublicOverviewRows([], 20)).toBeNull();
  });

  it("validates aggregate cells and maps one-snapshot chunk metadata", () => {
    expect(
      mapPublicOverviewRows(
        [
          {
            meta_world_slug: "2027",
            meta_as_of: "2026-12-20T00:00:01Z",
            cell_world_slug: "2027",
            cell_size: 100,
            x: 0,
            y: 100,
            occupied_count: "25",
            active_count: 24,
            listed_count: 23n,
            cell_as_of: "2026-12-20T00:00:00Z",
          },
        ],
        100,
      )?.cells,
    ).toEqual([
      {
        x: 0,
        y: 100,
        occupiedCount: 25,
        activeCount: 24,
        listedCount: 23,
      },
    ]);

    const chunk = mapPublicChunkRows([
      {
        meta_world_slug: "2027",
        meta_cx: 0,
        meta_cy: 0,
        meta_revision: "7",
        kind: "public",
        public_id: PUBLIC_ID,
        cell_world_slug: "2027",
        x: 2,
        y: 3,
        slot_number: 3003,
        nickname: "えま太郎",
        category: "health",
        design_id: "basic_wood",
        visibility: "public",
        message_visibility: "owner_only",
        message_text: null,
        version: 1,
        created_at: "2026-12-19T15:00:00Z",
        updated_at: "2026-12-20T00:00:00Z",
      },
    ]);
    expect(chunk?.revision).toBe(7);
    expect(JSON.stringify(chunk)).not.toContain(SECRET_WISH);
  });

  it("keeps occupied cells identifier-free and rejects accidental metadata", () => {
    const occupied = {
      meta_world_slug: "2027",
      meta_cx: 0,
      meta_cy: 0,
      meta_revision: 1,
      kind: "occupied",
      public_id: null,
      cell_world_slug: "2027",
      x: 3,
      y: 3,
      slot_number: 3004,
      nickname: null,
      category: null,
      design_id: null,
      visibility: null,
      message_visibility: null,
      message_text: null,
      version: null,
      created_at: null,
      updated_at: null,
    };
    expect(mapPublicChunkRows([occupied])?.cells).toEqual([
      { kind: "occupied", x: 3, y: 3, slotNumber: 3004 },
    ]);
    expect(() =>
      mapPublicChunkRows([{ ...occupied, public_id: PUBLIC_ID }]),
    ).toThrow();
    expect(mapPublicChunkRows([])).toBeNull();
  });

  it("maps the owner row independently with the secret wish", () => {
    const ema = mapOwnerEmaRow({
      ...publicRow,
      wish_text: SECRET_WISH,
      status: "active",
      edit_content: true,
      visibility_mode: "all",
      can_delete: true,
    });

    expect(ema.wishText).toBe(SECRET_WISH);
    expect(ema.capabilities).toEqual({
      editContent: true,
      visibilityMode: "all",
      delete: true,
    });
  });

  it("uses DB server time and validates world counters", () => {
    const response = mapPublicWorldRow(
      {
        world_slug: "2027",
        world_name: "2027年のえまのわ",
        world_state: "open",
        width: 1000,
        height: 1000,
        opens_at: "2026-12-19T15:00:00Z",
        closes_at: "2027-12-31T15:00:00Z",
        accepting_posts: true,
        occupied_count: "3",
        active_count: 2n,
        listed_count: 1,
        stats_as_of: "2026-12-20T00:00:00Z",
        server_time: "2026-12-20T00:00:01Z",
      },
      { groups: false, fulfillment: false, payments: false },
    );

    expect(response.serverTime).toBe("2026-12-20T00:00:01.000Z");
    expect(response.stats).toMatchObject({
      occupiedCount: 3,
      activeCount: 2,
      listedCount: 1,
    });
  });

  it("maps an owner world summary without private wish text", () => {
    const summary = mapOwnerWorldRow({
      world_slug: "2027",
      world_name: "2027年のえまのわ",
      world_state: "open",
      public_id: PUBLIC_ID,
      slot_number: 3003,
      status: "active",
      design_id: "basic_wood",
      visibility: "unlisted",
      message_visibility: "owner_only",
      version: 2,
      updated_at: "2026-12-20T00:00:00Z",
    });

    expect(summary.ema.publicId).toBe(PUBLIC_ID);
    expect(summary).not.toHaveProperty("wishText");
    expect(JSON.stringify(summary)).not.toContain(SECRET_WISH);
  });

  it("maps only the allowed create receipt fields", () => {
    const result = mapCreateEmaRow({
      public_id: PUBLIC_ID,
      world_slug: "2027",
      version: 1,
      result: "created",
      canonical_url: `/w/2027/e/${PUBLIC_ID}`,
      replayed: false,
    });

    expect(result).toEqual({
      receipt: {
        publicId: PUBLIC_ID,
        worldSlug: "2027",
        version: 1,
        result: "created",
        canonicalUrl: `/w/2027/e/${PUBLIC_ID}`,
      },
      replayed: false,
    });
  });

  it("maps update and delete receipts through the same strict DTO", () => {
    expect(
      mapMutationEmaRow({
        public_id: PUBLIC_ID,
        world_slug: "2027",
        version: 2,
        result: "updated",
        canonical_url: `/w/2027/e/${PUBLIC_ID}`,
        replayed: true,
      }),
    ).toEqual({
      receipt: {
        publicId: PUBLIC_ID,
        worldSlug: "2027",
        version: 2,
        result: "updated",
        canonicalUrl: `/w/2027/e/${PUBLIC_ID}`,
      },
      replayed: true,
    });
  });
});
