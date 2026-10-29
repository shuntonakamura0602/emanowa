import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ApiRouteError } from "@/server/api/errors";
import {
  getAdminPageAuthState,
  requireVerifiedAdminActorFromClient,
  type AdminAuthClient,
} from "./auth";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER_UID = "22222222-2222-4222-8222-222222222222";

function authClient(
  options: {
    claimsUid?: string | null;
    userUid?: string | null;
    anonymous?: boolean;
    email?: string | null;
    confirmed?: boolean;
    aal?: string | null;
  } = {},
): AdminAuthClient {
  const {
    claimsUid = UID,
    userUid = UID,
    anonymous = false,
    email = "moderator@example.test",
    confirmed = true,
    aal = "aal2",
  } = options;
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: claimsUid
          ? { claims: { sub: claimsUid, is_anonymous: anonymous } }
          : null,
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: userUid
            ? {
                id: userUid,
                is_anonymous: anonymous,
                email,
                email_confirmed_at: confirmed ? "2026-10-29T00:00:00Z" : null,
              }
            : null,
        },
        error: null,
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: {
            currentLevel: aal,
            nextLevel: aal,
            currentAuthenticationMethods: [],
          },
          error: null,
        }),
      },
    },
  } as unknown as AdminAuthClient;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRouteError);
    expect((error as ApiRouteError).code).toBe(code);
  }
}

describe("admin auth", () => {
  it("separates the page MFA gate from the verified admin actor", async () => {
    await expect(
      getAdminPageAuthState(authClient({ aal: "aal1" })),
    ).resolves.toEqual({ kind: "mfa_required", uid: UID });
    await expect(getAdminPageAuthState(authClient())).resolves.toEqual({
      kind: "verified",
      actor: { uid: UID },
    });
  });

  it("does not offer MFA setup before a fresh confirmed email user exists", async () => {
    await expect(
      getAdminPageAuthState(authClient({ userUid: null })),
    ).resolves.toEqual({ kind: "session_expired" });
    await expect(
      getAdminPageAuthState(authClient({ confirmed: false })),
    ).resolves.toEqual({ kind: "email_required" });
  });

  it("requires verified claims, a fresh matching user, confirmed email and aal2", async () => {
    await expect(
      requireVerifiedAdminActorFromClient(authClient()),
    ).resolves.toEqual({ uid: UID });
  });

  it("returns AUTH_REQUIRED without verified claims", async () => {
    await expectCode(
      requireVerifiedAdminActorFromClient(authClient({ claimsUid: null })),
      "AUTH_REQUIRED",
    );
  });

  it("returns SESSION_EXPIRED when fresh user identity differs", async () => {
    await expectCode(
      requireVerifiedAdminActorFromClient(authClient({ userUid: OTHER_UID })),
      "SESSION_EXPIRED",
    );
  });

  it.each([
    { anonymous: true },
    { email: null },
    { confirmed: false },
    { aal: "aal1" },
  ])("fails closed without a complete admin assurance %#", async (options) => {
    await expectCode(
      requireVerifiedAdminActorFromClient(authClient(options)),
      "ADMIN_REQUIRED",
    );
  });
});
