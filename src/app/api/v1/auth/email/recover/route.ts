import { createEmailEndpointHandler } from "@/server/auth/email-handler";
import { getServerRuntimeConfig } from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createEmailEndpointHandler("recover", {
  getConfig: getServerRuntimeConfig,
  createClient(responseHeaders, config) {
    return createSupabaseServerClient({ config, responseHeaders });
  },
});
