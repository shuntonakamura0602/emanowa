import type { WorldConfig } from "@/config/worlds";

export type PublicCapabilities = {
  groups: boolean;
  fulfillment: boolean;
  payments: boolean;
};

export type PublicServiceStatus =
  "ready" | "configuration_required" | "development_demo";

export type PublicRuntimeConfig = {
  appOrigin: string | null;
  featuredWorld: WorldConfig;
  capabilities: PublicCapabilities;
  supabase: {
    url: string | null;
    publishableKey: string | null;
    configured: boolean;
  };
  captchaSiteKey: string | null;
  captchaRequired: boolean;
  services: {
    status: PublicServiceStatus;
    authConfigured: boolean;
    persistenceConfigured: boolean;
    writesAvailable: boolean;
  };
};

export type PublicRuntimeConfigSource = {
  appOrigin: string | null;
  featuredWorld: WorldConfig;
  capabilities: PublicCapabilities;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  captchaSiteKey: string | null;
  captchaRequired: boolean;
  serviceStatus: PublicServiceStatus;
  databaseConfigured: boolean;
  writesAvailable: boolean;
};

/**
 * Explicit allow-list for configuration sent to Client Components. Never pass
 * the server configuration object through props or JSON serialization.
 */
export function createPublicRuntimeConfig(
  source: PublicRuntimeConfigSource,
): PublicRuntimeConfig {
  const authConfigured = Boolean(
    source.supabaseUrl && source.supabasePublishableKey,
  );

  return {
    appOrigin: source.appOrigin,
    featuredWorld: source.featuredWorld,
    capabilities: { ...source.capabilities },
    supabase: {
      url: source.supabaseUrl,
      publishableKey: source.supabasePublishableKey,
      configured: authConfigured,
    },
    captchaSiteKey: source.captchaSiteKey,
    captchaRequired: source.captchaRequired,
    services: {
      status: source.serviceStatus,
      authConfigured,
      persistenceConfigured: source.databaseConfigured,
      writesAvailable: source.writesAvailable,
    },
  };
}
