import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerRuntimeConfig: vi.fn(),
  probeAdminDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getServerRuntimeConfig: mocks.getServerRuntimeConfig,
}));
vi.mock("@/server/admin/pool", () => ({
  probeAdminDatabase: mocks.probeAdminDatabase,
}));

import { GET } from "./route";

describe("operations readiness health route", () => {
  beforeEach(() => {
    mocks.getServerRuntimeConfig.mockReset();
    mocks.probeAdminDatabase.mockReset();
    mocks.getServerRuntimeConfig.mockReturnValue({
      adminOperationsAvailable: true,
    });
    mocks.probeAdminDatabase.mockResolvedValue(undefined);
  });

  it("reports ready only after the dedicated admin boundary is reachable", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
    expect(mocks.probeAdminDatabase).toHaveBeenCalledOnce();
  });

  it("fails closed without revealing configuration or connection details", async () => {
    mocks.getServerRuntimeConfig.mockReturnValue({
      adminOperationsAvailable: false,
    });

    const missing = await GET();
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ status: "not_ready" });
    expect(mocks.probeAdminDatabase).not.toHaveBeenCalled();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerRuntimeConfig.mockReturnValue({
      adminOperationsAvailable: true,
    });
    mocks.probeAdminDatabase.mockRejectedValue(
      new Error("postgresql://admin:secret@example.invalid/database"),
    );

    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "not_ready" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[emanowa:health] operations dependency check failed.",
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret");
    errorSpy.mockRestore();
  });
});
