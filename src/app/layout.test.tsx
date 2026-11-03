import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicRuntimeConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({
  getPublicRuntimeConfig: mocks.getPublicRuntimeConfig,
}));

import { generateMetadata } from "./layout";

describe("root crawler metadata", () => {
  beforeEach(() => {
    mocks.getPublicRuntimeConfig.mockReset();
  });

  it("adds noindex outside an approved production publication", () => {
    for (const config of [
      { environment: "staging", publication: { ready: true } },
      { environment: "production", publication: { ready: false } },
    ]) {
      mocks.getPublicRuntimeConfig.mockReturnValue(config);
      expect(generateMetadata().robots).toMatchObject({
        index: false,
        follow: false,
      });
    }
  });

  it("allows indexing only for an approved ready production", () => {
    mocks.getPublicRuntimeConfig.mockReturnValue({
      environment: "production",
      publication: { ready: true },
    });

    expect(generateMetadata().robots).toBeUndefined();
  });
});
