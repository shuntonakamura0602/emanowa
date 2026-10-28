import { describe, expect, it } from "vitest";

import {
  mapCreateEmaRow,
  mapOwnerEmaRow,
  mapPublicEmaRow,
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
});
