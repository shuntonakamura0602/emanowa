import { describe, expect, it } from "vitest";

import { createPublicRuntimeConfig } from "@/config/public";
import {
  parseServerEnvironment,
  toPublicRuntimeConfigSource,
} from "@/server/config/parse";

const configuredEnvironment = {
  EMANOWA_ENVIRONMENT: "development",
  EMANOWA_DATA_MODE: "database",
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  DATABASE_URL: "postgresql://emanowa_app:secret@localhost:5432/emanowa",
  MIGRATION_DATABASE_URL:
    "postgresql://migration:other-secret@localhost:5432/emanowa",
  CAPTCHA_SECRET_KEY: "captcha-secret-sentinel",
  NEXT_PUBLIC_CAPTCHA_SITE_KEY: "captcha-site-key",
  RATE_LIMIT_HMAC_SECRET: "rate-limit-secret-sentinel",
};

describe("parseServerEnvironment", () => {
  it("defaults all future capabilities to false", () => {
    const config = parseServerEnvironment({});

    expect(config.capabilities).toEqual({
      groups: false,
      fulfillment: false,
      payments: false,
    });
    expect(config.featuredWorld.slug).toBe("2027");
    expect(config.dataMode).toBe("unconfigured");
    expect(config.serviceStatus).toBe("configuration_required");
    expect(config.writesAvailable).toBe(false);
  });

  it("accepts an explicitly configured database environment", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ENABLE_GROUPS: "true",
    });

    expect(config.capabilities).toEqual({
      groups: true,
      fulfillment: false,
      payments: false,
    });
    expect(config.serviceStatus).toBe("ready");
    expect(config.writesAvailable).toBe(true);
    expect(config.database.roleName).toBe("emanowa_app");
    expect(config.captcha.configured).toBe(true);
    expect(toPublicRuntimeConfigSource(config).captchaRequired).toBe(false);
  });

  it("does not serialize server secrets into public config", () => {
    const serverConfig = parseServerEnvironment(configuredEnvironment);
    const publicConfig = createPublicRuntimeConfig(
      toPublicRuntimeConfigSource(serverConfig),
    );
    const serialized = JSON.stringify(publicConfig);

    expect(serialized).toContain("publishable-test-key");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("captcha-secret-sentinel");
    expect(serialized).not.toContain("rate-limit-secret-sentinel");
  });

  it("rejects demo mode in production instead of falling back", () => {
    const config = parseServerEnvironment({
      EMANOWA_ENVIRONMENT: "production",
      EMANOWA_DATA_MODE: "demo",
    });

    expect(config.dataMode).toBe("unconfigured");
    expect(config.writesAvailable).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "EMANOWA_DATA_MODE",
        code: "forbidden",
        severity: "error",
      }),
    );
  });

  it("rejects a privileged or unexpected role for normal API traffic", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/emanowa",
    });

    expect(config.writesAvailable).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "DATABASE_URL",
        code: "forbidden",
        severity: "error",
      }),
    );
  });

  it("requires CAPTCHA configuration for staging and production writes", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: undefined,
      CAPTCHA_SECRET_KEY: undefined,
    });

    expect(config.captcha.required).toBe(true);
    expect(config.captcha.configured).toBe(false);
    expect(config.writesAvailable).toBe(false);
    expect(toPublicRuntimeConfigSource(config).captchaRequired).toBe(true);
    expect(config.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "NEXT_PUBLIC_CAPTCHA_SITE_KEY" }),
        expect.objectContaining({ key: "CAPTCHA_SECRET_KEY" }),
      ]),
    );
  });

  it("fails closed when NODE_ENV is production but deployment environment is omitted", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      EMANOWA_ENVIRONMENT: undefined,
      NODE_ENV: "production",
    });

    expect(config.environment).toBe("production");
    expect(config.captcha.required).toBe(true);
    expect(config.writesAvailable).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "EMANOWA_ENVIRONMENT",
        code: "missing",
        severity: "error",
      }),
    );
  });

  it("keeps production CAPTCHA required when the deployment environment is invalid", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      EMANOWA_ENVIRONMENT: "prod",
      NODE_ENV: "production",
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: undefined,
      CAPTCHA_SECRET_KEY: undefined,
    });

    expect(config.environment).toBe("production");
    expect(config.captcha.required).toBe(true);
    expect(config.writesAvailable).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "EMANOWA_ENVIRONMENT",
        code: "invalid",
        severity: "error",
      }),
    );
  });

  it("reports invalid flags without enabling them", () => {
    const config = parseServerEnvironment({ ENABLE_PAYMENTS: "yes" });

    expect(config.capabilities.payments).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "ENABLE_PAYMENTS",
        code: "invalid",
      }),
    );
  });

  it("reports an unknown featured world and uses the safe configured world", () => {
    const config = parseServerEnvironment({ FEATURED_WORLD_SLUG: "2099" });

    expect(config.featuredWorld.slug).toBe("2027");
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "FEATURED_WORLD_SLUG",
        code: "invalid",
      }),
    );
  });
});
