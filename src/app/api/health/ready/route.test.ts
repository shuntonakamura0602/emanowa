import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerRuntimeConfig: vi.fn(),
  getPublicWorld: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerRuntimeConfig: mocks.getServerRuntimeConfig,
}));
vi.mock("@/server/ema/repository", () => ({
  getPublicWorld: mocks.getPublicWorld,
}));

import { GET } from "./route";

describe("readiness health route", () => {
  beforeEach(() => {
    mocks.getServerRuntimeConfig.mockReset();
    mocks.getPublicWorld.mockReset();
    mocks.getServerRuntimeConfig.mockReturnValue({
      publicationReady: true,
      featuredWorld: { slug: "2027" },
    });
  });

  it("reports ready only after the configured world is reachable", async () => {
    mocks.getPublicWorld.mockResolvedValue({ world: { slug: "2027" } });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.getPublicWorld).toHaveBeenCalledWith("2027");
  });

  it("does not reveal missing setting names when publication is not ready", async () => {
    mocks.getServerRuntimeConfig.mockReturnValue({
      publicationReady: false,
      featuredWorld: { slug: "2027" },
      issues: [{ key: "DATABASE_URL" }],
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(mocks.getPublicWorld).not.toHaveBeenCalled();
  });

  it("returns the same minimal response when a dependency fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPublicWorld.mockRejectedValue(
      new Error("postgresql://user:secret@example.invalid/db"),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[emanowa:health] readiness dependency check failed.",
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret");
    errorSpy.mockRestore();
  });
});
