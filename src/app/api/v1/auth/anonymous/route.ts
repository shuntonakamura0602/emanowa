import { getServerRuntimeConfig } from "@/server/config";
import { createAnonymousSessionHandler } from "@/server/auth/anonymous-handler";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";

export const POST = createAnonymousSessionHandler({
  getConfig: getServerRuntimeConfig,
  createClient(responseHeaders, config) {
    return createSupabaseServerClient({
      config,
      responseHeaders,
    });
  },
});
