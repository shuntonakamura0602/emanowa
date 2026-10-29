import {
  FEATURED_WORLD_SLUG,
  getWorldConfig,
  WORLD_2027,
  type WorldConfig,
} from "@/config/worlds";
import type {
  PublicCapabilities,
  PublicRuntimeConfigSource,
  PublicServiceStatus,
} from "@/config/public";
import {
  validateDatabaseConnectionUrl,
  type ApplicationDatabaseRole,
  type ValidatedDatabaseConnection,
} from "@/server/config/database";

export type EnvironmentName = "development" | "test" | "staging" | "production";

export type DataMode = "database" | "demo" | "unconfigured";

export type ConfigurationIssue = {
  key: string;
  code: "missing" | "invalid" | "forbidden";
  severity: "warning" | "error";
  message: string;
};

export type ServerRuntimeConfig = {
  environment: EnvironmentName;
  dataMode: DataMode;
  appOrigin: string | null;
  featuredWorld: WorldConfig;
  capabilities: PublicCapabilities;
  supabase: {
    url: string | null;
    publishableKey: string | null;
    configured: boolean;
  };
  database: {
    connection: ValidatedDatabaseConnection<"emanowa_app"> | null;
    adminConnection: ValidatedDatabaseConnection<"emanowa_admin_app"> | null;
    configured: boolean;
    adminConfigured: boolean;
  };
  captcha: {
    siteKey: string | null;
    secretKey: string | null;
    configured: boolean;
    required: boolean;
  };
  rateLimitHmacSecret: string | null;
  trustedProxyHops: number | null;
  operations: {
    operatorName: string | null;
    contactUrl: string | null;
  };
  serviceStatus: PublicServiceStatus;
  writesAvailable: boolean;
  issues: readonly ConfigurationIssue[];
};

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function value(source: EnvironmentSource, key: string): string | null {
  const raw = source[key]?.trim();
  return raw ? raw : null;
}

function issueSeverity(environment: EnvironmentName): "warning" | "error" {
  return environment === "production" || environment === "staging"
    ? "error"
    : "warning";
}

function parseEnvironment(
  source: EnvironmentSource,
  issues: ConfigurationIssue[],
): EnvironmentName {
  const raw = value(source, "EMANOWA_ENVIRONMENT");
  if (!raw) {
    if (source.NODE_ENV === "production") {
      issues.push({
        key: "EMANOWA_ENVIRONMENT",
        code: "missing",
        severity: "error",
        message:
          "production runtimeでは staging または production を明示してください。",
      });
    }
    if (source.NODE_ENV === "test") return "test";
    return source.NODE_ENV === "production" ? "production" : "development";
  }

  if (
    raw === "development" ||
    raw === "test" ||
    raw === "staging" ||
    raw === "production"
  ) {
    return raw;
  }

  issues.push({
    key: "EMANOWA_ENVIRONMENT",
    code: "invalid",
    severity: "error",
    message:
      "development / test / staging / production のいずれかを指定してください。",
  });
  return source.NODE_ENV === "production" ? "production" : "development";
}

function parseBoolean(
  source: EnvironmentSource,
  key: string,
  issues: ConfigurationIssue[],
): boolean {
  const raw = value(source, key);
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;

  issues.push({
    key,
    code: "invalid",
    severity: "error",
    message: "true または false を指定してください。",
  });
  return false;
}

function parseHttpUrl(
  source: EnvironmentSource,
  key: string,
  issues: ConfigurationIssue[],
): string | null {
  const raw = value(source, key);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    issues.push({
      key,
      code: "invalid",
      severity: "error",
      message: "http または https の有効なURLを指定してください。",
    });
    return null;
  }
}

function parseHttpOrigin(
  source: EnvironmentSource,
  key: string,
  issues: ConfigurationIssue[],
): string | null {
  const raw = value(source, key);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("not an origin");
    }
    return parsed.origin;
  } catch {
    issues.push({
      key,
      code: "invalid",
      severity: "error",
      message:
        "userinfo・path・query・fragmentを含まないhttp/https originを指定してください。",
    });
    return null;
  }
}

function parseApplicationDatabaseConnection<
  Role extends ApplicationDatabaseRole,
>(
  source: EnvironmentSource,
  key: string,
  expectedRole: Role,
  issues: ConfigurationIssue[],
): ValidatedDatabaseConnection<Role> | null {
  const raw = value(source, key);
  if (!raw) return null;

  const result = validateDatabaseConnectionUrl(raw, expectedRole);
  if (!result.ok) {
    issues.push({
      key,
      code: result.code,
      severity: "error",
      message: result.message,
    });
    return null;
  }

  return result.connection;
}

function parseTrustedProxyHops(
  source: EnvironmentSource,
  issues: ConfigurationIssue[],
): number | null {
  const raw = value(source, "TRUSTED_PROXY_HOPS");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 8) {
    issues.push({
      key: "TRUSTED_PROXY_HOPS",
      code: "invalid",
      severity: "error",
      message: "信頼するプロキシ段数を1〜8の整数で指定してください。",
    });
    return null;
  }
  return parsed;
}

function addMissingIssue(
  issues: ConfigurationIssue[],
  environment: EnvironmentName,
  key: string,
  message: string,
): void {
  issues.push({
    key,
    code: "missing",
    severity: issueSeverity(environment),
    message,
  });
}

function parseDataMode(
  source: EnvironmentSource,
  environment: EnvironmentName,
  databaseConfigured: boolean,
  issues: ConfigurationIssue[],
): DataMode {
  const raw = value(source, "EMANOWA_DATA_MODE");
  let mode: DataMode;

  if (!raw) {
    mode = databaseConfigured ? "database" : "unconfigured";
  } else if (raw === "database" || raw === "demo" || raw === "unconfigured") {
    mode = raw;
  } else {
    issues.push({
      key: "EMANOWA_DATA_MODE",
      code: "invalid",
      severity: "error",
      message: "database / demo / unconfigured のいずれかを指定してください。",
    });
    mode = "unconfigured";
  }

  if (
    (environment === "production" || environment === "staging") &&
    mode === "demo"
  ) {
    issues.push({
      key: "EMANOWA_DATA_MODE",
      code: "forbidden",
      severity: "error",
      message: "demo は development または test でのみ利用できます。",
    });
    return "unconfigured";
  }

  if (mode === "database" && !databaseConfigured) {
    return "unconfigured";
  }

  return mode;
}

export function parseServerEnvironment(
  source: EnvironmentSource,
): ServerRuntimeConfig {
  const issues: ConfigurationIssue[] = [];
  const environment = parseEnvironment(source, issues);
  const appOrigin = parseHttpOrigin(source, "APP_ORIGIN", issues);
  const supabaseUrl = parseHttpUrl(source, "NEXT_PUBLIC_SUPABASE_URL", issues);
  const supabasePublishableKey = value(
    source,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const databaseConnection = parseApplicationDatabaseConnection(
    source,
    "DATABASE_URL",
    "emanowa_app",
    issues,
  );
  const adminDatabaseConnection = parseApplicationDatabaseConnection(
    source,
    "ADMIN_DATABASE_URL",
    "emanowa_admin_app",
    issues,
  );

  const featuredSlug =
    value(source, "FEATURED_WORLD_SLUG") ?? FEATURED_WORLD_SLUG;
  let featuredWorld = getWorldConfig(featuredSlug);
  if (!featuredWorld) {
    issues.push({
      key: "FEATURED_WORLD_SLUG",
      code: "invalid",
      severity: "error",
      message: "リポジトリに定義されたworld slugを指定してください。",
    });
    featuredWorld = WORLD_2027;
  }

  const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
  const databaseConfigured = Boolean(databaseConnection);
  const captchaSiteKey = value(source, "NEXT_PUBLIC_CAPTCHA_SITE_KEY");
  const captchaSecretKey = value(source, "CAPTCHA_SECRET_KEY");
  const captchaConfigured = Boolean(captchaSiteKey && captchaSecretKey);
  const captchaRequired =
    environment === "production" || environment === "staging";
  const rateLimitHmacSecret = value(source, "RATE_LIMIT_HMAC_SECRET");
  const trustedProxyHops = parseTrustedProxyHops(source, issues);

  if (!appOrigin) {
    addMissingIssue(
      issues,
      environment,
      "APP_ORIGIN",
      "正規URLと認証戻り先の設定がありません。",
    );
  }
  if (!supabaseUrl) {
    addMissingIssue(
      issues,
      environment,
      "NEXT_PUBLIC_SUPABASE_URL",
      "Supabase Authの接続先がありません。",
    );
  }
  if (!supabasePublishableKey) {
    addMissingIssue(
      issues,
      environment,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "Supabase Authの公開用キーがありません。",
    );
  }
  if (!value(source, "DATABASE_URL")) {
    addMissingIssue(
      issues,
      environment,
      "DATABASE_URL",
      "本番保存用DBの接続がありません。",
    );
  }
  if (!value(source, "ADMIN_DATABASE_URL")) {
    addMissingIssue(
      issues,
      environment,
      "ADMIN_DATABASE_URL",
      "管理API用の限定DB接続がありません。",
    );
  }
  if (captchaRequired && !captchaSiteKey) {
    addMissingIssue(
      issues,
      environment,
      "NEXT_PUBLIC_CAPTCHA_SITE_KEY",
      "公開環境の匿名登録にはCAPTCHA site keyが必要です。",
    );
  }
  if (captchaRequired && !captchaSecretKey) {
    addMissingIssue(
      issues,
      environment,
      "CAPTCHA_SECRET_KEY",
      "公開環境の匿名登録にはCAPTCHA secret設定が必要です。",
    );
  }
  if (!rateLimitHmacSecret) {
    addMissingIssue(
      issues,
      environment,
      "RATE_LIMIT_HMAC_SECRET",
      "共有回数制限のHMAC秘密がありません。",
    );
  } else if (
    captchaRequired &&
    new TextEncoder().encode(rateLimitHmacSecret).byteLength < 32
  ) {
    issues.push({
      key: "RATE_LIMIT_HMAC_SECRET",
      code: "invalid",
      severity: "error",
      message: "公開環境では32バイト以上のランダム値を指定してください。",
    });
  }
  if (captchaRequired && trustedProxyHops === null) {
    addMissingIssue(
      issues,
      environment,
      "TRUSTED_PROXY_HOPS",
      "画像生成の送信元を安全に判定するプロキシ段数が必要です。",
    );
  }

  const dataMode = parseDataMode(
    source,
    environment,
    databaseConfigured,
    issues,
  );
  const capabilities = {
    groups: parseBoolean(source, "ENABLE_GROUPS", issues),
    fulfillment: parseBoolean(source, "ENABLE_FULFILLMENT", issues),
    payments: parseBoolean(source, "ENABLE_PAYMENTS", issues),
  } satisfies PublicCapabilities;

  const writesAvailable =
    dataMode === "database" &&
    supabaseConfigured &&
    databaseConfigured &&
    Boolean(rateLimitHmacSecret) &&
    !issues.some((issue) => issue.severity === "error");

  const serviceStatus: PublicServiceStatus =
    dataMode === "demo"
      ? "development_demo"
      : writesAvailable
        ? "ready"
        : "configuration_required";

  return {
    environment,
    dataMode,
    appOrigin,
    featuredWorld,
    capabilities,
    supabase: {
      url: supabaseUrl,
      publishableKey: supabasePublishableKey,
      configured: supabaseConfigured,
    },
    database: {
      connection: databaseConnection,
      adminConnection: adminDatabaseConnection,
      configured: databaseConfigured,
      adminConfigured: Boolean(adminDatabaseConnection),
    },
    captcha: {
      siteKey: captchaSiteKey,
      secretKey: captchaSecretKey,
      configured: captchaConfigured,
      required: captchaRequired,
    },
    rateLimitHmacSecret,
    trustedProxyHops,
    operations: {
      operatorName: value(source, "OPERATOR_NAME"),
      contactUrl: value(source, "CONTACT_URL"),
    },
    serviceStatus,
    writesAvailable,
    issues,
  };
}

export function toPublicRuntimeConfigSource(
  config: ServerRuntimeConfig,
): PublicRuntimeConfigSource {
  return {
    appOrigin: config.appOrigin,
    featuredWorld: config.featuredWorld,
    capabilities: config.capabilities,
    supabaseUrl: config.supabase.url,
    supabasePublishableKey: config.supabase.publishableKey,
    captchaSiteKey: config.captcha.siteKey,
    captchaRequired: config.captcha.required,
    serviceStatus: config.serviceStatus,
    databaseConfigured: config.database.configured,
    writesAvailable: config.writesAvailable,
  };
}

export function formatConfigurationIssues(
  issues: readonly ConfigurationIssue[],
): string {
  return issues
    .map(
      ({ key, severity, message }) =>
        `[${severity.toUpperCase()}] ${key}: ${message}`,
    )
    .join("\n");
}
