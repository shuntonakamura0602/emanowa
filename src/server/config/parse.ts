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
    url: string | null;
    migrationUrl: string | null;
    roleName: string | null;
    configured: boolean;
  };
  captcha: {
    siteKey: string | null;
    secretKey: string | null;
    configured: boolean;
    required: boolean;
  };
  rateLimitHmacSecret: string | null;
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
    return source.NODE_ENV === "test" ? "test" : "development";
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
  return "development";
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

function parseDatabaseUrl(
  source: EnvironmentSource,
  key: string,
  issues: ConfigurationIssue[],
): string | null {
  const raw = value(source, key);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
    return raw;
  } catch {
    issues.push({
      key,
      code: "invalid",
      severity: "error",
      message: "PostgreSQLの有効な接続URLを指定してください。",
    });
    return null;
  }
}

function databaseRoleName(databaseUrl: string | null): string | null {
  if (!databaseUrl) return null;

  try {
    const username = decodeURIComponent(new URL(databaseUrl).username);
    return username.split(".", 1)[0] || null;
  } catch {
    return null;
  }
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
  const appOrigin = parseHttpUrl(source, "APP_ORIGIN", issues);
  const supabaseUrl = parseHttpUrl(source, "NEXT_PUBLIC_SUPABASE_URL", issues);
  const supabasePublishableKey = value(
    source,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const databaseUrl = parseDatabaseUrl(source, "DATABASE_URL", issues);
  const migrationDatabaseUrl = parseDatabaseUrl(
    source,
    "MIGRATION_DATABASE_URL",
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
  const databaseConfigured = Boolean(databaseUrl);
  const databaseRole = databaseRoleName(databaseUrl);
  const captchaSiteKey = value(source, "NEXT_PUBLIC_CAPTCHA_SITE_KEY");
  const captchaSecretKey = value(source, "CAPTCHA_SECRET_KEY");
  const captchaConfigured = Boolean(captchaSiteKey && captchaSecretKey);
  const captchaRequired =
    environment === "production" || environment === "staging";

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
  if (!databaseConfigured) {
    addMissingIssue(
      issues,
      environment,
      "DATABASE_URL",
      "本番保存用DBの接続がありません。",
    );
  }
  if (databaseRole && databaseRole !== "emanowa_app") {
    issues.push({
      key: "DATABASE_URL",
      code: "forbidden",
      severity: "error",
      message:
        "通常APIは限定・非所有者・NOBYPASSRLSの emanowa_app ロールで接続してください。",
    });
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
      url: databaseUrl,
      migrationUrl: migrationDatabaseUrl,
      roleName: databaseRole,
      configured: databaseConfigured,
    },
    captcha: {
      siteKey: captchaSiteKey,
      secretKey: captchaSecretKey,
      configured: captchaConfigured,
      required: captchaRequired,
    },
    rateLimitHmacSecret: value(source, "RATE_LIMIT_HMAC_SECRET"),
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
