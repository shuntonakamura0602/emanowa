import { describe, expect, it, vi } from "vitest";

import type { ClaimsAuthClient } from "@/server/supabase/contracts";

import {
  AuthRequiredError,
  extractVerifiedActor,
  getVerifiedActorFromClient,
  requireVerifiedActorFromClient,
} from "./claims";

const UID = "11111111-1111-4111-8111-111111111111";

function claimsClient(result: unknown): ClaimsAuthClient {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue(result),
    },
  } as unknown as ClaimsAuthClient;
}

describe("verified actor claims", () => {
  it("extracts a verified anonymous actor from sub and is_anonymous", () => {
    expect(
      extractVerifiedActor({ sub: UID, is_anonymous: true } as never),
    ).toEqual({ uid: UID, isAnonymous: true });
  });

  it("rejects a missing or malformed subject", () => {
    expect(extractVerifiedActor({ sub: "not-a-uuid" } as never)).toBeNull();
    expect(extractVerifiedActor(null)).toBeNull();
  });

  it("returns null when getClaims cannot verify the session", async () => {
    const client = claimsClient({ data: null, error: new Error("invalid") });
    await expect(getVerifiedActorFromClient(client)).resolves.toBeNull();
  });

  it("throws a typed error when a verified actor is required", async () => {
    const client = claimsClient({ data: null, error: null });
    await expect(requireVerifiedActorFromClient(client)).rejects.toBeInstanceOf(
      AuthRequiredError,
    );
  });
});
