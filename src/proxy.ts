import type { NextRequest } from "next/server";

import { getServerRuntimeConfig } from "@/server/config";
import { updateSupabaseSession } from "@/server/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { supabase } = getServerRuntimeConfig();
  const credentials =
    supabase.url && supabase.publishableKey
      ? { url: supabase.url, publishableKey: supabase.publishableKey }
      : null;

  return updateSupabaseSession(request, credentials);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
