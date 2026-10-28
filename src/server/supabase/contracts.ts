import type { SupabaseClient } from "@supabase/supabase-js";

export type ClaimsAuthClient = {
  auth: Pick<SupabaseClient["auth"], "getClaims">;
};

export type AnonymousAuthClient = {
  auth: Pick<SupabaseClient["auth"], "getClaims" | "signInAnonymously">;
};

export type EmailAuthClient = {
  auth: Pick<
    SupabaseClient["auth"],
    "getUser" | "signInWithOtp" | "signOut" | "updateUser" | "verifyOtp"
  >;
};
