import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decodeAdminReportCursor, encodeAdminReportCursor } from "./cursor";

const cursor = {
  createdAt: "2026-10-29T00:00:00.000Z",
  reportId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("admin report cursor", () => {
  it("round-trips a cursor only in the bound report state", () => {
    const encoded = encodeAdminReportCursor("open", cursor);
    expect(decodeAdminReportCursor(encoded, "open")).toEqual(cursor);
    expect(() => decodeAdminReportCursor(encoded, "resolved")).toThrow();
    expect(decodeAdminReportCursor(null, "open")).toBeNull();
  });

  it.each(["", "***", "e30", "a".repeat(769)])(
    "rejects an invalid cursor %s",
    (value) => {
      expect(() => decodeAdminReportCursor(value, "open")).toThrow();
    },
  );
});
