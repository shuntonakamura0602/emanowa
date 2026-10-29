import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiRouteError } from "@/server/api/errors";
import { extractVerifiedActor } from "@/server/auth/claims";

export type AdminAuthClient = {
  auth: Pick<SupabaseClient["auth"], "getClaims" | "getUser"> & {
    mfa: Pick<SupabaseClient["auth"]["mfa"], "getAuthenticatorAssuranceLevel">;
  };
};

export type VerifiedAdminActor = {
  uid: string;
};

export type AdminPageAuthState =
  | { kind: "unauthenticated" }
  | { kind: "session_expired" }
  | { kind: "email_required" }
  | { kind: "mfa_required"; uid: string }
  | { kind: "verified"; actor: VerifiedAdminActor };

export async function getAdminPageAuthState(
  client: AdminAuthClient,
): Promise<AdminPageAuthState> {
  const claimsResult = await client.auth.getClaims();
  const claimsActor = extractVerifiedActor(claimsResult.data?.claims);
  if (claimsResult.error || !claimsActor) return { kind: "unauthenticated" };

  const [userResult, assuranceResult] = await Promise.all([
    client.auth.getUser(),
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const user = userResult.data.user;
  if (
    userResult.error ||
    !user ||
    user.id !== claimsActor.uid ||
    assuranceResult.error
  ) {
    return { kind: "session_expired" };
  }
  if (user.is_anonymous === true || !user.email || !user.email_confirmed_at) {
    return { kind: "email_required" };
  }
  if (assuranceResult.data.currentLevel !== "aal2") {
    return { kind: "mfa_required", uid: claimsActor.uid };
  }
  return { kind: "verified", actor: { uid: claimsActor.uid } };
}

/**
 * Establishes fresh Auth state before the database performs its own
 * admin_users lookup. No user-editable metadata or email string is used as a
 * role grant.
 */
export async function requireVerifiedAdminActorFromClient(
  client: AdminAuthClient,
): Promise<VerifiedAdminActor> {
  const state = await getAdminPageAuthState(client);
  if (state.kind === "unauthenticated") {
    throw new ApiRouteError("AUTH_REQUIRED", "認証が必要です。");
  }
  if (state.kind === "session_expired") {
    throw new ApiRouteError(
      "SESSION_EXPIRED",
      "管理者セッションを再確認してください。",
    );
  }
  if (state.kind === "email_required" || state.kind === "mfa_required") {
    throw new ApiRouteError(
      "ADMIN_REQUIRED",
      "管理操作には確認済みメールとMFA認証が必要です。",
    );
  }
  return state.actor;
}
