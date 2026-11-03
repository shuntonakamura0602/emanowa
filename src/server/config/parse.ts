import { Buffer } from "node:buffer";

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
  publication: {
    approved: boolean;
    policyEffectiveDate: string | null;
    retention: {
      content: string | null;
      backups: string | null;
      logs: string | null;
    };
  };
  serviceStatus: PublicServiceStatus;
  writesAvailable: boolean;
  postingAvailable: boolean;
  publicationReady: boolean;
  adminOperationsAvailable: boolean;
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

function isPublicEnvironment(environment: EnvironmentName): boolean {
  return environment === "production" || environment === "staging";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
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

function parseHttpOrigin(
  source: EnvironmentSource,
  key: string,
  environment: EnvironmentName,
  issues: ConfigurationIssue[],
): string | null {
  const raw = value(source, key);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (isPublicEnvironment(environment) && parsed.protocol !== "https:") ||
      (isPublicEnvironment(environment) &&
        isLoopbackHostname(parsed.hostname)) ||
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
      message: isPublicEnvironment(environment)
        ? "userinfo・path・query・fragmentを含まないHTTPS originを指定してください。"
        : "userinfo・path・query・fragmentを含まないhttp/https originを指定してください。",
    });
    return null;
  }
}

function parseSupabasePublishableKey(
  source: EnvironmentSource,
  issues: ConfigurationIssue[],
): string | null {
  const key = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
  const raw = value(source, key);
  if (!raw) return null;

  let privileged = raw.toLowerCase().startsWith("sb_secret_");
  const jwtParts = raw.split(".");
  if (!privileged && jwtParts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(jwtParts[1] ?? "", "base64url").toString("utf8"),
      ) as { role?: unknown };
      privileged =
        typeof payload.role === "string" &&
        [
          "service_role",
          "supabase_admin",
          "postgres",
          "authenticator",
          "dashboard_user",
        ].includes(payload.role);
    } catch {
      // Supabase's current publishable-key format is not a JWT. An opaque key
      // remains acceptable unless it has a known privileged-key signature.
    }
  }

  if (privileged) {
    issues.push({
      key,
      code: "forbidden",
      severity: "error",
      message:
        "ブラウザー公開用のpublishable keyを指定してください。秘密鍵やservice role keyは使用できません。",
    });
    return null;
  }

  return raw;
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

function isPlaceholderPublicationText(input: string): boolean {
  const normalized = input.normalize("NFKC").toLowerCase();
  return (
    /(?:\b(?:todo|tbd|placeholder)\b|未定|要設定|要入力|仮入力|ダミー)/u.test(
      normalized,
    ) || /[<＜][^>＞]+[>＞]/u.test(normalized)
  );
}

function parsePublicationText(
  source: EnvironmentSource,
  key: string,
  environment: EnvironmentName,
  issues: ConfigurationIssue[],
  options: {
    label: string;
    minCharacters: number;
    maxBytes: number;
  },
): string | null {
  const raw = value(source, key);
  if (!raw) {
    if (isPublicEnvironment(environment)) {
      addMissingIssue(
        issues,
        environment,
        key,
        `${options.label}を実際の運用内容に合わせて指定してください。`,
      );
    }
    return null;
  }

  const characters = Array.from(raw).length;
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (
    characters < options.minCharacters ||
    bytes > options.maxBytes ||
    isPlaceholderPublicationText(raw)
  ) {
    issues.push({
      key,
      code: "invalid",
      severity: issueSeverity(environment),
      message: `${options.label}には仮文言ではなく、実際の運用内容を指定してください。`,
    });
    return null;
  }

  return raw;
}

function parseContactUrl(
  source: EnvironmentSource,
  environment: EnvironmentName,
  issues: ConfigurationIssue[],
): string | null {
  const key = "CONTACT_URL";
  const raw = value(source, key);
  if (!raw) {
    if (isPublicEnvironment(environment)) {
      addMissingIssue(
        issues,
        environment,
        key,
        "利用者が連絡できるHTTPSの問い合わせ先を指定してください。",
      );
    }
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      (isPublicEnvironment(environment) &&
        isLoopbackHostname(parsed.hostname)) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("not a public HTTPS contact URL");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    issues.push({
      key,
      code: "invalid",
      severity: issueSeverity(environment),
      message:
        "userinfo・fragmentを含まないHTTPSの問い合わせURLを指定してください。",
    });
    return null;
  }
}

function parsePolicyEffectiveDate(
  source: EnvironmentSource,
  environment: EnvironmentName,
  issues: ConfigurationIssue[],
): string | null {
  const key = "POLICY_EFFECTIVE_DATE";
  const raw = value(source, key);
  if (!raw) {
    if (isPublicEnvironment(environment)) {
      addMissingIssue(
        issues,
        environment,
        key,
        "利用条件とプライバシー説明の適用日を指定してください。",
      );
    }
    return null;
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(raw) ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== raw
  ) {
    issues.push({
      key,
      code: "invalid",
      severity: issueSeverity(environment),
      message: "実在する日付をYYYY-MM-DD形式で指定してください。",
    });
    return null;
  }

  return raw;
}

function parsePublicationApproval(
  source: EnvironmentSource,
  environment: EnvironmentName,
  issues: ConfigurationIssue[],
): boolean {
  const key = "PUBLICATION_APPROVED";
  const raw = value(source, key);
  if (!raw) {
    if (environment === "production") {
      addMissingIssue(
        issues,
        environment,
        key,
        "本番公開の承認後にtrueを明示してください。",
      );
    }
    return false;
  }
  if (raw === "true") return true;
  if (raw === "false") {
    if (environment === "production") {
      issues.push({
        key,
        code: "forbidden",
        severity: "error",
        message: "本番公開には明示的な公開承認が必要です。",
      });
    }
    return false;
  }

  issues.push({
    key,
    code: "invalid",
    severity: issueSeverity(environment),
    message: "true または false を指定してください。",
  });
  return false;
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
    if (isPublicEnvironment(environment)) {
      addMissingIssue(
        issues,
        environment,
        "EMANOWA_DATA_MODE",
        "公開環境ではdatabaseを明示してください。",
      );
      mode = "unconfigured";
    } else {
      mode = databaseConfigured ? "database" : "unconfigured";
    }
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
  const appOrigin = parseHttpOrigin(source, "APP_ORIGIN", environment, issues);
  const supabaseUrl = parseHttpOrigin(
    source,
    "NEXT_PUBLIC_SUPABASE_URL",
    environment,
    issues,
  );
  const supabasePublishableKey = parseSupabasePublishableKey(source, issues);
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

  if (!value(source, "APP_ORIGIN")) {
    addMissingIssue(
      issues,
      environment,
      "APP_ORIGIN",
      "正規URLと認証戻り先の設定がありません。",
    );
  }
  if (!value(source, "NEXT_PUBLIC_SUPABASE_URL")) {
    addMissingIssue(
      issues,
      environment,
      "NEXT_PUBLIC_SUPABASE_URL",
      "Supabase Authの接続先がありません。",
    );
  }
  if (!value(source, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
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

  const environmentClassificationValid = !issues.some(
    (issue) =>
      issue.key === "EMANOWA_ENVIRONMENT" && issue.severity === "error",
  );
  const databaseModeRequested =
    value(source, "EMANOWA_DATA_MODE") === "database";

  const rateLimitConfigured = Boolean(
    rateLimitHmacSecret &&
    (!isPublicEnvironment(environment) ||
      new TextEncoder().encode(rateLimitHmacSecret).byteLength >= 32),
  );

  // This gate protects ordinary owner/report recovery writes, so it contains
  // only their shared dependencies. Publication-only settings (CAPTCHA,
  // trusted proxy, admin DB, policy copy, feature flags, and approval) must
  // not prevent an existing owner from narrowing visibility or deleting.
  const writesAvailable = Boolean(
    dataMode === "database" &&
    environmentClassificationValid &&
    appOrigin &&
    supabaseConfigured &&
    databaseConfigured &&
    rateLimitConfigured,
  );
  const adminOperationsAvailable = Boolean(
    databaseModeRequested &&
    environmentClassificationValid &&
    appOrigin &&
    supabaseConfigured &&
    adminDatabaseConnection,
  );

  const serviceStatus: PublicServiceStatus =
    dataMode === "demo"
      ? "development_demo"
      : writesAvailable
        ? "ready"
        : "configuration_required";

  if (isPublicEnvironment(environment)) {
    for (const [key, enabled] of [
      ["ENABLE_GROUPS", capabilities.groups],
      ["ENABLE_FULFILLMENT", capabilities.fulfillment],
      ["ENABLE_PAYMENTS", capabilities.payments],
    ] as const) {
      if (enabled) {
        issues.push({
          key,
          code: "forbidden",
          severity: "error",
          message: "P0公開時は未提供機能をfalseに固定してください。",
        });
      }
    }
  }

  // Public-document settings are deliberately parsed after writesAvailable is
  // decided. Missing legal copy must block publication, but must not disable
  // an owner's edit/delete recovery path on an otherwise healthy runtime.
  const operatorName = parsePublicationText(
    source,
    "OPERATOR_NAME",
    environment,
    issues,
    {
      label: "運営者名",
      minCharacters: 2,
      maxBytes: 512,
    },
  );
  const contactUrl = parseContactUrl(source, environment, issues);
  const policyEffectiveDate = parsePolicyEffectiveDate(
    source,
    environment,
    issues,
  );
  const contentRetentionNotice = parsePublicationText(
    source,
    "CONTENT_RETENTION_NOTICE",
    environment,
    issues,
    {
      label: "投稿内容の保存期間説明",
      minCharacters: 8,
      maxBytes: 2_000,
    },
  );
  const backupRetentionNotice = parsePublicationText(
    source,
    "BACKUP_RETENTION_NOTICE",
    environment,
    issues,
    {
      label: "バックアップの保存期間説明",
      minCharacters: 8,
      maxBytes: 2_000,
    },
  );
  const logRetentionNotice = parsePublicationText(
    source,
    "LOG_RETENTION_NOTICE",
    environment,
    issues,
    {
      label: "ログの保存期間説明",
      minCharacters: 8,
      maxBytes: 2_000,
    },
  );
  const publicationApproved = parsePublicationApproval(
    source,
    environment,
    issues,
  );
  const hasPublicationErrors = issues.some(
    (issue) => issue.severity === "error",
  );
  const publicationReady = Boolean(
    writesAvailable &&
    appOrigin?.startsWith("https://") &&
    adminOperationsAvailable &&
    captchaConfigured &&
    trustedProxyHops !== null &&
    operatorName &&
    contactUrl &&
    policyEffectiveDate &&
    contentRetentionNotice &&
    backupRetentionNotice &&
    logRetentionNotice &&
    !capabilities.groups &&
    !capabilities.fulfillment &&
    !capabilities.payments &&
    !hasPublicationErrors &&
    (environment !== "production" || publicationApproved),
  );
  const postingAvailable =
    writesAvailable && (!isPublicEnvironment(environment) || publicationReady);

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
      operatorName,
      contactUrl,
    },
    publication: {
      approved: publicationApproved,
      policyEffectiveDate,
      retention: {
        content: contentRetentionNotice,
        backups: backupRetentionNotice,
        logs: logRetentionNotice,
      },
    },
    serviceStatus,
    writesAvailable,
    postingAvailable,
    publicationReady,
    adminOperationsAvailable,
    issues,
  };
}

export function toPublicRuntimeConfigSource(
  config: ServerRuntimeConfig,
): PublicRuntimeConfigSource {
  return {
    environment: config.environment,
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
    postingAvailable: config.postingAvailable,
    operations: config.operations,
    publicationReady: config.publicationReady,
    policyEffectiveDate: config.publication.policyEffectiveDate,
    retention: config.publication.retention,
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
