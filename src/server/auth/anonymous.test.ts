import { AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AnonymousAuthClient } from "@/server/supabase/contracts";

import { ensureAnonymousSession, SessionVerificationError } from "./anonymous";

const UID = "11111111-1111-4111-8111-111111111111";

function authClient(
  claimsResult: unknown,
  signInResult: unknown = { data: { user: { id: UID } }, error: null },
) {
  const getClaims = vi.fn().mockResolvedValue(claimsResult);
  const signInAnonymously = vi.fn().mockResolvedValue(signInResult);
  const client = {
    auth: { getClaims, signInAnonymously },
  } as unknown as AnonymousAuthClient;
  return { client, getClaims, signInAnonymously };
}

describe("ensureAnonymousSession", () => {
  it("reuses an existing anonymous session", async () => {
    const { client, signInAnonymously } = authClient({
      data: { claims: { sub: UID, is_anonymous: true } },
      error: null,
    });

    await expect(ensureAnonymousSession(client, "captcha")).resolves.toEqual({
      authenticated: true,
      created: false,
      isAnonymous: true,
      uid: UID,
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("never replaces a registered session with an anonymous account", async () => {
    const { client, signInAnonymously } = authClient({
      data: { claims: { sub: UID, is_anonymous: false } },
      error: null,
    });

    await expect(ensureAnonymousSession(client)).resolves.toMatchObject({
      created: false,
      isAnonymous: false,
      uid: UID,
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates an anonymous account only when no session exists", async () => {
    const { client, signInAnonymously } = authClient({
      data: null,
      error: null,
    });

    await expect(ensureAnonymousSession(client, "captcha")).resolves.toEqual({
      authenticated: true,
      created: true,
      isAnonymous: true,
      uid: UID,
    });
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: "captcha" },
    });
  });

  it("treats Supabase AuthSessionMissingError as a first-time visitor", async () => {
    const { client, signInAnonymously } = authClient({
      data: null,
      error: new AuthSessionMissingError(),
    });

    await expect(
      ensureAnonymousSession(client, "captcha"),
    ).resolves.toMatchObject({
      created: true,
      isAnonymous: true,
      uid: UID,
    });
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it("does not create an account when existing-session verification fails", async () => {
    const { client, signInAnonymously } = authClient({
      data: null,
      error: new Error("invalid token"),
    });

    await expect(ensureAnonymousSession(client)).rejects.toBeInstanceOf(
      SessionVerificationError,
    );
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("rejects a malformed UID returned from anonymous sign-in", async () => {
    const { client } = authClient(
      { data: null, error: null },
      { data: { user: { id: "not-a-uuid" } }, error: null },
    );

    await expect(ensureAnonymousSession(client)).rejects.toThrow(
      "匿名セッションを開始できませんでした。",
    );
  });
});
