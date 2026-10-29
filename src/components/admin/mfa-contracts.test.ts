import { describe, expect, it } from "vitest";

import {
  firstVerifiedTotpFactorId,
  normalizeTotpCode,
  totpQrDataUrl,
} from "./mfa-contracts";

describe("admin MFA contracts", () => {
  it("accepts only a six-digit TOTP code", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("12345a")).toBeNull();
  });

  it("encodes raw SVG without changing an existing image data URL", () => {
    expect(totpQrDataUrl("<svg><text>秘密</text></svg>")).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/u,
    );
    expect(totpQrDataUrl("data:image/svg+xml;base64,abc")).toBe(
      "data:image/svg+xml;base64,abc",
    );
  });

  it("uses only a verified TOTP factor for a sign-in challenge", () => {
    expect(
      firstVerifiedTotpFactorId([
        { id: "unverified", factor_type: "totp", status: "unverified" },
        { id: "phone", factor_type: "phone", status: "verified" },
        { id: "verified", factor_type: "totp", status: "verified" },
      ]),
    ).toBe("verified");
  });
});
