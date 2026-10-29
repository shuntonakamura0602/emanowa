import { beforeEach, describe, expect, it, vi } from "vitest";

const { getNearbySlots } = vi.hoisted(() => ({
  getNearbySlots: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/ema/repository", () => ({ getNearbySlots }));

import { GET } from "./route";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";
const nearbyResponse = {
  origin: { x: 10, y: 20 },
  candidates: [{ x: 10, y: 20, slotNumber: 20_011 }],
  searchedRadius: 3 as const,
};

function request(query: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/v1/worlds/2027/nearby${query}`),
    {
      params: Promise.resolve({ slug: "2027" }),
    },
  );
}

describe("nearby route", () => {
  beforeEach(() => {
    getNearbySlots.mockReset();
  });

  it("rejects mixed near and coordinate origins without reaching the database", async () => {
    const response = await request(`?near=${PUBLIC_ID}&x=10&y=20`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_QUERY" },
    });
    expect(getNearbySlots).not.toHaveBeenCalled();
  });

  it("returns an exact nearby lookup without cache or session cookies", async () => {
    getNearbySlots.mockResolvedValue(nearbyResponse);

    const response = await request(`?near=${PUBLIC_ID}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.json()).toEqual(nearbyResponse);
    expect(getNearbySlots).toHaveBeenCalledWith("2027", { near: PUBLIC_ID });
  });

  it("supports a coordinate origin and returns missing targets as 404", async () => {
    getNearbySlots
      .mockResolvedValueOnce(nearbyResponse)
      .mockResolvedValueOnce(null);

    const coordinateResponse = await request("?x=10&y=20");
    const missingResponse = await request(`?near=${PUBLIC_ID}`);

    expect(coordinateResponse.status).toBe(200);
    expect(getNearbySlots).toHaveBeenNthCalledWith(1, "2027", {
      x: 10,
      y: 20,
    });
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});
