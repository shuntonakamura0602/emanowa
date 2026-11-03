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
  CAPTCHA_SECRET_KEY: "captcha-secret-sentinel",
  NEXT_PUBLIC_CAPTCHA_SITE_KEY: "captcha-site-key",
  RATE_LIMIT_HMAC_SECRET: "rate-limit-secret-sentinel",
};

const publicationEnvironment = {
  APP_ORIGIN: "https://emanowa.test",
  ADMIN_DATABASE_URL:
    "postgresql://emanowa_admin_app:secret@localhost:5432/emanowa",
  TRUSTED_PROXY_HOPS: "1",
  OPERATOR_NAME: "えまのわ運営テスト",
  CONTACT_URL: "https://support.emanowa.test/contact",
  POLICY_EFFECTIVE_DATE: "2026-11-03",
  CONTENT_RETENTION_NOTICE:
    "投稿内容は削除されるまで保存し、削除後は稼働DBから消去します。",
  BACKUP_RETENTION_NOTICE: "バックアップは作成から30日後に削除します。",
  LOG_RETENTION_NOTICE: "アクセスログは取得から90日後に削除します。",
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
    expect(config.postingAvailable).toBe(false);
    expect(config.publicationReady).toBe(false);
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
    expect(config.postingAvailable).toBe(true);
    expect(config.database.connection?.roleName).toBe("emanowa_app");
    expect(config.captcha.configured).toBe(true);
    expect(toPublicRuntimeConfigSource(config).captchaRequired).toBe(false);
  });

  it("accepts only a bare APP_ORIGIN and never preserves credentials or URL state", () => {
    const values = [
      "https://user:secret@example.com",
      "https://example.com/base",
      "https://example.com/?token=secret",
      "https://example.com/#private",
    ];

    for (const appOrigin of values) {
      const config = parseServerEnvironment({
        ...configuredEnvironment,
        APP_ORIGIN: appOrigin,
      });
      expect(config.appOrigin).toBeNull();
      expect(config.writesAvailable).toBe(false);
      expect(config.issues).toContainEqual(
        expect.objectContaining({ key: "APP_ORIGIN", code: "invalid" }),
      );
    }

    expect(
      parseServerEnvironment({
        ...configuredEnvironment,
        APP_ORIGIN: "https://example.com/",
      }).appOrigin,
    ).toBe("https://example.com");
  });

  it("accepts only a bare Supabase origin and requires HTTPS publicly", () => {
    const local = parseServerEnvironment({
      ...configuredEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
    });
    expect(local.supabase.url).toBe("http://127.0.0.1:54321");

    for (const supabaseUrl of [
      "https://user:secret@example.supabase.co",
      "https://example.supabase.co/rest/v1",
      "https://example.supabase.co/?token=secret",
      "https://example.supabase.co/#private",
    ]) {
      const config = parseServerEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      });
      expect(config.supabase.url).toBeNull();
      expect(config.writesAvailable).toBe(false);
      expect(config.issues).toContainEqual(
        expect.objectContaining({
          key: "NEXT_PUBLIC_SUPABASE_URL",
          code: "invalid",
        }),
      );
    }

    const insecurePublic = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });
    expect(insecurePublic.supabase.url).toBeNull();
    expect(insecurePublic.writesAvailable).toBe(false);
    expect(insecurePublic.publicationReady).toBe(false);
  });

  it("rejects Supabase privileged keys from the browser-public slot", () => {
    const serviceRoleJwt = [
      Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
      Buffer.from(JSON.stringify({ role: "service_role" })).toString(
        "base64url",
      ),
      "signature",
    ].join(".");

    for (const publishableKey of ["sb_secret_example", serviceRoleJwt]) {
      const config = parseServerEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      });
      expect(config.supabase.publishableKey).toBeNull();
      expect(config.supabase.configured).toBe(false);
      expect(config.writesAvailable).toBe(false);
      expect(config.issues).toContainEqual(
        expect.objectContaining({
          key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          code: "forbidden",
        }),
      );
    }
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

  it("allow-lists public operator and policy information without approval internals", () => {
    const serverConfig = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });
    const publicConfig = createPublicRuntimeConfig(
      toPublicRuntimeConfigSource(serverConfig),
    );

    expect(publicConfig.operations).toEqual({
      operatorName: "えまのわ運営テスト",
      contactUrl: "https://support.emanowa.test/contact",
    });
    expect(publicConfig.publication).toMatchObject({
      ready: true,
      policyEffectiveDate: "2026-11-03",
    });
    expect(publicConfig.services.postingAvailable).toBe(true);
    expect(publicConfig.publication).not.toHaveProperty("approved");
    expect(JSON.stringify(publicConfig)).not.toContain("issues");
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

  it("keeps normal and moderation database privileges on separate roles", () => {
    const valid = parseServerEnvironment({
      ...configuredEnvironment,
      ADMIN_DATABASE_URL:
        "postgresql://emanowa_admin_app:secret@localhost:5432/emanowa",
    });
    expect(valid.database.adminConfigured).toBe(true);
    expect(valid.database.adminConnection?.roleName).toBe("emanowa_admin_app");

    const invalid = parseServerEnvironment({
      ...configuredEnvironment,
      ADMIN_DATABASE_URL:
        "postgresql://emanowa_app:secret@localhost:5432/emanowa",
    });
    expect(invalid.database.adminConfigured).toBe(false);
    expect(invalid.writesAvailable).toBe(true);
    expect(invalid.issues).toContainEqual(
      expect.objectContaining({
        key: "ADMIN_DATABASE_URL",
        code: "forbidden",
      }),
    );

    const unsafe = parseServerEnvironment({
      ...configuredEnvironment,
      ADMIN_DATABASE_URL:
        "postgresql://emanowa_admin_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&host=attacker.example.com",
    });
    expect(unsafe.database.adminConfigured).toBe(false);
    expect(unsafe.database.adminConnection).toBeNull();
    expect(unsafe.issues).toContainEqual(
      expect.objectContaining({
        key: "ADMIN_DATABASE_URL",
        code: "invalid",
      }),
    );
  });

  it("rejects connection-string query overrides before enabling database mode", () => {
    const unsafeUrls = [
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&host=attacker.example.com",
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=no-verify",
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&sslmode=require",
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&statement_timeout=0",
    ];

    for (const databaseUrl of unsafeUrls) {
      const config = parseServerEnvironment({
        ...configuredEnvironment,
        DATABASE_URL: databaseUrl,
      });

      expect(config.database.configured).toBe(false);
      expect(config.database.connection).toBeNull();
      expect(config.dataMode).toBe("unconfigured");
      expect(config.writesAvailable).toBe(false);
      expect(config.issues).toContainEqual(
        expect.objectContaining({
          key: "DATABASE_URL",
          code: "invalid",
          severity: "error",
        }),
      );
    }
  });

  it("accepts Supavisor-style pooler usernames without weakening role checks", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      DATABASE_URL:
        "postgresql://emanowa_app.project-ref:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/emanowa?sslmode=verify-full",
      ADMIN_DATABASE_URL:
        "postgresql://emanowa_admin_app.project-ref:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/emanowa?sslmode=verify-full",
    });

    expect(config.database.connection).toEqual(
      expect.objectContaining({
        roleName: "emanowa_app",
        transportSecurity: "verify-full",
      }),
    );
    expect(config.database.adminConnection).toEqual(
      expect.objectContaining({
        roleName: "emanowa_admin_app",
        transportSecurity: "verify-full",
      }),
    );
    expect(config.database.configured).toBe(true);
    expect(config.database.adminConfigured).toBe(true);
  });

  it("requires CAPTCHA configuration for public posting without disabling recovery writes", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: undefined,
      CAPTCHA_SECRET_KEY: undefined,
      PUBLICATION_APPROVED: "true",
    });

    expect(config.captcha.required).toBe(true);
    expect(config.captcha.configured).toBe(false);
    expect(config.writesAvailable).toBe(true);
    expect(config.postingAvailable).toBe(false);
    expect(config.publicationReady).toBe(false);
    expect(toPublicRuntimeConfigSource(config).captchaRequired).toBe(true);
    expect(config.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "NEXT_PUBLIC_CAPTCHA_SITE_KEY" }),
        expect.objectContaining({ key: "CAPTCHA_SECRET_KEY" }),
      ]),
    );
  });

  it("requires shared rate-limit and trusted proxy settings publicly", () => {
    const missing = parseServerEnvironment({
      ...configuredEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: undefined,
      TRUSTED_PROXY_HOPS: undefined,
    });
    expect(missing.writesAvailable).toBe(false);
    expect(missing.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "RATE_LIMIT_HMAC_SECRET" }),
        expect.objectContaining({ key: "TRUSTED_PROXY_HOPS" }),
      ]),
    );

    const configured = parseServerEnvironment({
      ...configuredEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      APP_ORIGIN: "https://emanowa.test",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      TRUSTED_PROXY_HOPS: "1",
      ADMIN_DATABASE_URL:
        "postgresql://emanowa_admin_app:secret@localhost:5432/emanowa",
    });
    expect(configured.trustedProxyHops).toBe(1);
    expect(configured.writesAvailable).toBe(true);
    expect(configured.postingAvailable).toBe(false);
    expect(configured.publicationReady).toBe(false);
  });

  it("does not let publication-only dependencies disable recovery writes", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      ADMIN_DATABASE_URL: undefined,
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: undefined,
      CAPTCHA_SECRET_KEY: undefined,
      TRUSTED_PROXY_HOPS: undefined,
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });

    expect(config.writesAvailable).toBe(true);
    expect(config.postingAvailable).toBe(false);
    expect(config.publicationReady).toBe(false);
    expect(config.database.adminConfigured).toBe(false);
    expect(config.adminOperationsAvailable).toBe(false);
    expect(config.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "ADMIN_DATABASE_URL" }),
        expect.objectContaining({ key: "NEXT_PUBLIC_CAPTCHA_SITE_KEY" }),
        expect.objectContaining({ key: "CAPTCHA_SECRET_KEY" }),
        expect.objectContaining({ key: "TRUSTED_PROXY_HOPS" }),
      ]),
    );
  });

  it("keeps emergency admin operations independent from the ordinary DB connection", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      DATABASE_URL: undefined,
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });

    expect(config.dataMode).toBe("unconfigured");
    expect(config.writesAvailable).toBe(false);
    expect(config.postingAvailable).toBe(false);
    expect(config.adminOperationsAvailable).toBe(true);
  });

  it("separates write recovery from production publication approval", () => {
    const missingApproval = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
    });

    expect(missingApproval.writesAvailable).toBe(true);
    expect(missingApproval.postingAvailable).toBe(false);
    expect(missingApproval.publicationReady).toBe(false);
    expect(missingApproval.issues).toContainEqual(
      expect.objectContaining({
        key: "PUBLICATION_APPROVED",
        code: "missing",
        severity: "error",
      }),
    );

    const approved = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });

    expect(approved.writesAvailable).toBe(true);
    expect(approved.postingAvailable).toBe(true);
    expect(approved.publicationReady).toBe(true);
    expect(approved.publication).toEqual({
      approved: true,
      policyEffectiveDate: "2026-11-03",
      retention: {
        content:
          "投稿内容は削除されるまで保存し、削除後は稼働DBから消去します。",
        backups: "バックアップは作成から30日後に削除します。",
        logs: "アクセスログは取得から90日後に削除します。",
      },
    });
  });

  it("allows staging readiness without production approval", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "staging",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: undefined,
    });

    expect(config.writesAvailable).toBe(true);
    expect(config.postingAvailable).toBe(true);
    expect(config.publication.approved).toBe(false);
    expect(config.publicationReady).toBe(true);
    expect(config.issues).not.toContainEqual(
      expect.objectContaining({ key: "PUBLICATION_APPROVED" }),
    );
  });

  it("requires explicit database mode before any public publication", () => {
    for (const environment of ["staging", "production"] as const) {
      const config = parseServerEnvironment({
        ...configuredEnvironment,
        ...publicationEnvironment,
        EMANOWA_ENVIRONMENT: environment,
        EMANOWA_DATA_MODE: undefined,
        RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
        PUBLICATION_APPROVED: "true",
      });

      expect(config.dataMode).toBe("unconfigured");
      expect(config.writesAvailable).toBe(false);
      expect(config.adminOperationsAvailable).toBe(false);
      expect(config.publicationReady).toBe(false);
      expect(config.postingAvailable).toBe(false);
      expect(config.issues).toContainEqual(
        expect.objectContaining({
          key: "EMANOWA_DATA_MODE",
          code: "missing",
          severity: "error",
        }),
      );
    }
  });

  it("rejects insecure or placeholder public information without disabling writes", () => {
    const insecureContact = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      CONTACT_URL: "http://support.emanowa.test/contact",
      PUBLICATION_APPROVED: "true",
    });
    expect(insecureContact.writesAvailable).toBe(true);
    expect(insecureContact.publicationReady).toBe(false);
    expect(insecureContact.operations.contactUrl).toBeNull();

    const placeholderRetention = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      BACKUP_RETENTION_NOTICE: "TODO: 後で設定します",
      PUBLICATION_APPROVED: "true",
    });
    expect(placeholderRetention.writesAvailable).toBe(true);
    expect(placeholderRetention.publicationReady).toBe(false);
    expect(placeholderRetention.publication.retention.backups).toBeNull();

    const invalidDate = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      POLICY_EFFECTIVE_DATE: "2026-02-30",
      PUBLICATION_APPROVED: "true",
    });
    expect(invalidDate.writesAvailable).toBe(true);
    expect(invalidDate.publicationReady).toBe(false);
    expect(invalidDate.publication.policyEffectiveDate).toBeNull();
  });

  it("requires an HTTPS bare origin for staging and production", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      APP_ORIGIN: "http://emanowa.test",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
    });

    expect(config.appOrigin).toBeNull();
    expect(config.writesAvailable).toBe(false);
    expect(config.publicationReady).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({ key: "APP_ORIGIN", code: "invalid" }),
    );
  });

  it("rejects loopback application, Supabase, and contact URLs publicly", () => {
    for (const loopback of [
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
    ]) {
      const app = parseServerEnvironment({
        ...configuredEnvironment,
        ...publicationEnvironment,
        EMANOWA_ENVIRONMENT: "production",
        APP_ORIGIN: loopback,
        RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
        PUBLICATION_APPROVED: "true",
      });
      expect(app.appOrigin).toBeNull();
      expect(app.publicationReady).toBe(false);

      const supabase = parseServerEnvironment({
        ...configuredEnvironment,
        ...publicationEnvironment,
        EMANOWA_ENVIRONMENT: "production",
        NEXT_PUBLIC_SUPABASE_URL: loopback,
        RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
        PUBLICATION_APPROVED: "true",
      });
      expect(supabase.supabase.url).toBeNull();
      expect(supabase.publicationReady).toBe(false);

      const contact = parseServerEnvironment({
        ...configuredEnvironment,
        ...publicationEnvironment,
        EMANOWA_ENVIRONMENT: "production",
        CONTACT_URL: `${loopback}/contact`,
        RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
        PUBLICATION_APPROVED: "true",
      });
      expect(contact.operations.contactUrl).toBeNull();
      expect(contact.publicationReady).toBe(false);
    }
  });

  it("blocks P0 publication when a future capability is enabled", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      ENABLE_GROUPS: "true",
      PUBLICATION_APPROVED: "true",
    });

    expect(config.writesAvailable).toBe(true);
    expect(config.postingAvailable).toBe(false);
    expect(config.publicationReady).toBe(false);
    expect(config.issues).toContainEqual(
      expect.objectContaining({
        key: "ENABLE_GROUPS",
        code: "forbidden",
        severity: "error",
      }),
    );
  });

  it("fails closed when NODE_ENV is production but deployment environment is omitted", () => {
    const config = parseServerEnvironment({
      ...configuredEnvironment,
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: undefined,
      NODE_ENV: "production",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
      PUBLICATION_APPROVED: "true",
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
      ...publicationEnvironment,
      EMANOWA_ENVIRONMENT: "prod",
      NODE_ENV: "production",
      APP_ORIGIN: "https://emanowa.test",
      RATE_LIMIT_HMAC_SECRET: "x".repeat(32),
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
