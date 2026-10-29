import { readFileSync } from "node:fs";

import type { PoolConfig } from "pg";

export type ApplicationDatabaseRole = "emanowa_app" | "emanowa_admin_app";

export type DatabaseTransportSecurity =
  "loopback" | "require" | "verify-ca" | "verify-full";

type DatabaseTlsFiles = Readonly<{
  certificatePath: string | null;
  keyPath: string | null;
  rootCertificatePath: string | null;
}>;

export type ValidatedDatabaseConnection<
  Role extends ApplicationDatabaseRole = ApplicationDatabaseRole,
> = Readonly<{
  database: string;
  host: string;
  password: string;
  port: number;
  roleName: Role;
  sslNegotiation: "postgres" | "direct";
  tls: false | DatabaseTlsFiles;
  transportSecurity: DatabaseTransportSecurity;
  user: string;
}>;

export type FixedApplicationDatabasePoolConfig = PoolConfig &
  Readonly<{ replication: "false" }>;

export type DatabaseConnectionValidation<Role extends ApplicationDatabaseRole> =
  | Readonly<{
      ok: true;
      connection: ValidatedDatabaseConnection<Role>;
    }>
  | Readonly<{
      ok: false;
      code: "invalid" | "forbidden";
      message: string;
    }>;

const ALLOWED_CONNECTION_QUERY_PARAMETERS = new Set([
  "sslcert",
  "sslkey",
  "sslmode",
  "sslnegotiation",
  "sslrootcert",
]);

const SAFE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const LOCAL_SSL_MODES = new Set(["disable", ...SAFE_SSL_MODES]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FIXED_SESSION_OPTIONS = "-c standard_conforming_strings=on";

function invalid(message: string): DatabaseConnectionValidation<never> {
  return { ok: false, code: "invalid", message };
}

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function optionalQueryValue(parsed: URL, key: string): string | null {
  return parsed.searchParams.get(key) || null;
}

export function validateDatabaseConnectionUrl<
  Role extends ApplicationDatabaseRole,
>(
  connectionString: string,
  expectedRole: Role,
): DatabaseConnectionValidation<Role> {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return invalid("PostgreSQLの有効な接続URLを指定してください。");
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.hash
  ) {
    return invalid(
      "fragmentを含まないPostgreSQLの有効な接続URLを指定してください。",
    );
  }

  const seenQueryKeys = new Set<string>();
  for (const key of parsed.searchParams.keys()) {
    if (
      key !== key.toLowerCase() ||
      !ALLOWED_CONNECTION_QUERY_PARAMETERS.has(key) ||
      seenQueryKeys.has(key)
    ) {
      return invalid(
        "接続URLのqueryには、重複のない小文字のTLS設定だけを指定してください。host・user・password・port・options・timeoutは上書きできません。",
      );
    }
    seenQueryKeys.add(key);
  }

  const sslModes = parsed.searchParams.getAll("sslmode");
  const sslMode = sslModes[0]?.toLowerCase() ?? null;
  const loopback = isLoopback(parsed.hostname);
  if (
    sslModes.length > 1 ||
    (sslMode !== null &&
      !(loopback ? LOCAL_SSL_MODES : SAFE_SSL_MODES).has(sslMode))
  ) {
    return invalid(
      loopback
        ? "ローカルDBのsslmodeはdisable、require、verify-ca、verify-fullのいずれかを指定してください。"
        : "remote DBにはsslmode=require、verify-ca、verify-fullのいずれかが必要です。",
    );
  }
  if (!loopback && sslMode === null) {
    return invalid(
      "remote DBにはsslmode=require、verify-ca、verify-fullのいずれかが必要です。",
    );
  }

  const sslNegotiation = parsed.searchParams.get("sslnegotiation");
  if (
    sslNegotiation !== null &&
    sslNegotiation !== "postgres" &&
    sslNegotiation !== "direct"
  ) {
    return invalid("sslnegotiationはpostgresまたはdirectを指定してください。");
  }
  if (sslNegotiation === "direct" && sslMode === "disable") {
    return invalid("sslnegotiation=directではTLSを無効化できません。");
  }

  let database: string;
  let host: string;
  let password: string;
  let user: string;
  try {
    database = decodeURI(parsed.pathname.slice(1));
    host = decodeURIComponent(parsed.hostname).replace(/^\[(.+)\]$/, "$1");
    password = decodeURIComponent(parsed.password);
    user = decodeURIComponent(parsed.username);
  } catch {
    return invalid("接続URLのpercent encodingを確認してください。");
  }
  const port = Number(parsed.port);
  if (
    !user ||
    !password ||
    !host ||
    !parsed.port ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !database
  ) {
    return invalid(
      "接続URLにはusername・password・host・port・databaseをすべて明示してください。",
    );
  }
  const roleName = user.split(".", 1)[0] ?? "";
  if (roleName !== expectedRole) {
    return {
      ok: false,
      code: "forbidden",
      message:
        expectedRole === "emanowa_app"
          ? "通常APIは限定・非所有者・NOBYPASSRLSの emanowa_app ロールで接続してください。"
          : "管理APIは専用の限定・非所有者・NOBYPASSRLSの emanowa_admin_app ロールで接続してください。",
    };
  }

  const certificatePath = optionalQueryValue(parsed, "sslcert");
  const keyPath = optionalQueryValue(parsed, "sslkey");
  const rootCertificatePath = optionalQueryValue(parsed, "sslrootcert");
  const tlsEnabled =
    sslMode !== "disable" &&
    (sslMode !== null ||
      sslNegotiation === "direct" ||
      certificatePath !== null ||
      keyPath !== null ||
      rootCertificatePath !== null);

  return {
    ok: true,
    connection: Object.freeze({
      database,
      host,
      password,
      port,
      roleName: expectedRole,
      sslNegotiation: sslNegotiation ?? "postgres",
      tls: tlsEnabled
        ? Object.freeze({
            certificatePath,
            keyPath,
            rootCertificatePath,
          })
        : false,
      transportSecurity:
        loopback && !tlsEnabled
          ? "loopback"
          : ((sslMode ?? "require") as Exclude<
              DatabaseTransportSecurity,
              "loopback"
            >),
      user,
    }),
  };
}

function createSslConfig(
  connection: ValidatedDatabaseConnection,
): PoolConfig["ssl"] {
  if (connection.tls === false) return false;

  return {
    rejectUnauthorized: true,
    ...(connection.tls.certificatePath
      ? { cert: readFileSync(connection.tls.certificatePath, "utf8") }
      : {}),
    ...(connection.tls.keyPath
      ? { key: readFileSync(connection.tls.keyPath, "utf8") }
      : {}),
    ...(connection.tls.rootCertificatePath
      ? { ca: readFileSync(connection.tls.rootCertificatePath, "utf8") }
      : {}),
  };
}

export function createApplicationDatabasePoolConfig(
  connection: ValidatedDatabaseConnection,
  applicationName: "emanowa-bff" | "emanowa-admin-bff",
): FixedApplicationDatabasePoolConfig {
  return {
    user: connection.user,
    password: connection.password,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    application_name: applicationName,
    options: FIXED_SESSION_OPTIONS,
    client_encoding: "UTF8",
    replication: "false",
    sslnegotiation: connection.sslNegotiation,
    ssl: createSslConfig(connection),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    idle_in_transaction_session_timeout: 5_000,
    allowExitOnIdle: true,
  };
}
