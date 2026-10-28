import { isAuthSessionMissingError } from "@supabase/supabase-js";

import type { AnonymousAuthClient } from "@/server/supabase/contracts";

import { extractVerifiedActor, isVerifiedSubject } from "./claims";

export type AnonymousSessionResult = {
  authenticated: true;
  created: boolean;
  isAnonymous: boolean;
  uid: string;
};

export class SessionVerificationError extends Error {
  constructor(cause?: unknown) {
    super("既存セッションを確認できませんでした。", { cause });
    this.name = "SessionVerificationError";
  }
}

export class AnonymousSignInError extends Error {
  readonly status: number | undefined;

  constructor(cause?: unknown) {
    super("匿名セッションを開始できませんでした。", { cause });
    this.name = "AnonymousSignInError";
    this.status = readStatus(cause);
  }
}

function readStatus(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return undefined;
  }
  return typeof value.status === "number" ? value.status : undefined;
}

export async function ensureAnonymousSession(
  client: AnonymousAuthClient,
  captchaToken?: string,
): Promise<AnonymousSessionResult> {
  const existing = await client.auth.getClaims();

  if (existing.error && !isAuthSessionMissingError(existing.error)) {
    // A bad or expired cookie might belong to a registered account. Never
    // replace it with a new anonymous identity on a verification failure.
    throw new SessionVerificationError(existing.error);
  }

  if (existing.data) {
    const actor = extractVerifiedActor(existing.data.claims);
    if (!actor) throw new SessionVerificationError();

    return {
      authenticated: true,
      created: false,
      isAnonymous: actor.isAnonymous,
      uid: actor.uid,
    };
  }

  const signedIn = await client.auth.signInAnonymously({
    options: { captchaToken },
  });
  const uid = signedIn.data.user?.id;

  if (signedIn.error || !isVerifiedSubject(uid)) {
    throw new AnonymousSignInError(signedIn.error);
  }

  return {
    authenticated: true,
    created: true,
    isAnonymous: true,
    uid,
  };
}
