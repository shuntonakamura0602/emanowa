import type { JwtPayload } from "@supabase/supabase-js";

import type { ClaimsAuthClient } from "@/server/supabase/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type VerifiedActor = {
  uid: string;
  isAnonymous: boolean;
};

export class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED" as const;

  constructor() {
    super("認証済みセッションが必要です。");
    this.name = "AuthRequiredError";
  }
}

export function isVerifiedSubject(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function extractVerifiedActor(
  claims: JwtPayload | null | undefined,
): VerifiedActor | null {
  if (!claims || !isVerifiedSubject(claims.sub)) return null;

  return {
    uid: claims.sub,
    isAnonymous: claims.is_anonymous === true,
  };
}

export async function getVerifiedActorFromClient(
  client: ClaimsAuthClient,
): Promise<VerifiedActor | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;

  return extractVerifiedActor(data.claims);
}

export async function requireVerifiedActorFromClient(
  client: ClaimsAuthClient,
): Promise<VerifiedActor> {
  const actor = await getVerifiedActorFromClient(client);
  if (!actor) throw new AuthRequiredError();
  return actor;
}
