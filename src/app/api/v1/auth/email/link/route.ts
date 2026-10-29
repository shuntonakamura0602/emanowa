import { createEmailEndpointHandler } from "@/server/auth/email-handler";
import { getServerRuntimeConfig } from "@/server/config";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  enforceOtpLinkVerificationRateLimit,
  enforceOtpRecoveryVerificationRateLimit,
  reserveOtpRateLimit,
} from "@/server/rate-limit/enforce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createEmailEndpointHandler("link", {
  getConfig: getServerRuntimeConfig,
  reserveOtpRateLimit,
  enforceOtpLinkVerificationRateLimit,
  enforceOtpRecoveryVerificationRateLimit,
  createClient(responseHeaders, config) {
    return createSupabaseServerClient({ config, responseHeaders });
  },
});
