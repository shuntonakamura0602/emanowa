import type { ClaimsAuthClient } from "@/server/supabase/contracts";
import { createSupabaseServerClient } from "@/server/supabase/server";

import {
  getVerifiedActorFromClient,
  requireVerifiedActorFromClient,
} from "./claims";

export type { VerifiedActor } from "./claims";
export { AuthRequiredError } from "./claims";

export async function getVerifiedActor(client?: ClaimsAuthClient) {
  const requestClient = client ?? (await createSupabaseServerClient());
  return getVerifiedActorFromClient(requestClient);
}

export async function requireVerifiedActor(client?: ClaimsAuthClient) {
  const requestClient = client ?? (await createSupabaseServerClient());
  return requireVerifiedActorFromClient(requestClient);
}
