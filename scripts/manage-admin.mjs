import { readFileSync } from "node:fs";

import pg from "pg";

const { Client } = pg;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESTRICTED_ROLES = new Set([
  "emanowa_app",
  "emanowa_admin_app",
  "emanowa_admin_provisioner",
  "emanowa_owner",
]);
const ALLOWED_CONNECTION_QUERY_PARAMETERS = new Set([
  "sslcert",
  "sslkey",
  "sslmode",
  "sslnegotiation",
  "sslrootcert",
]);
const SAFE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const LOCAL_SSL_MODES = new Set(["disable", ...SAFE_SSL_MODES]);
const FIXED_SESSION_OPTIONS = "-c standard_conforming_strings=on";

function usage() {
  return "使い方: pnpm admin:access -- <enable|disable> <Auth user UUID v4>";
}

function isLoopbackDatabase(connectionUrl) {
  return ["127.0.0.1", "::1", "[::1]"].includes(
    connectionUrl.hostname.toLowerCase(),
  );
}

function hasUnsafeConnectionQuery(connectionUrl) {
  const seen = new Set();
  for (const key of connectionUrl.searchParams.keys()) {
    if (
      key !== key.toLowerCase() ||
      !ALLOWED_CONNECTION_QUERY_PARAMETERS.has(key) ||
      seen.has(key)
    ) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

function validateTransportSecurity(connectionUrl) {
  const loopback = isLoopbackDatabase(connectionUrl);
  const rawSslMode = connectionUrl.searchParams.get("sslmode");
  const sslMode = rawSslMode?.toLowerCase();
  if (
    (rawSslMode !== null &&
      !(loopback ? LOCAL_SSL_MODES : SAFE_SSL_MODES).has(sslMode)) ||
    (!loopback && rawSslMode === null)
  ) {
    throw new Error(
      loopback
        ? "MIGRATION_DATABASE_URLのsslmodeはdisable、require、verify-ca、verify-fullのいずれかを指定してください。"
        : "remoteのMIGRATION_DATABASE_URLにはsslmode=require、verify-ca、verify-fullのいずれかが必要です。",
    );
  }

  const sslNegotiation = connectionUrl.searchParams.get("sslnegotiation");
  if (
    sslNegotiation !== null &&
    sslNegotiation !== "postgres" &&
    sslNegotiation !== "direct"
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URLのsslnegotiationはpostgresまたはdirectを指定してください。",
    );
  }
  if (sslNegotiation === "direct" && sslMode === "disable") {
    throw new Error(
      "MIGRATION_DATABASE_URLでsslnegotiation=directを使う場合はTLSを無効化できません。",
    );
  }
}

function parseRequiredConnection(connectionUrl) {
  let database;
  let host;
  let password;
  let user;
  try {
    database = decodeURI(connectionUrl.pathname.slice(1));
    host = decodeURIComponent(connectionUrl.hostname).replace(
      /^\[(.+)\]$/,
      "$1",
    );
    password = decodeURIComponent(connectionUrl.password);
    user = decodeURIComponent(connectionUrl.username);
  } catch {
    throw new Error(
      "MIGRATION_DATABASE_URLのpercent encodingを確認してください。",
    );
  }
  const port = Number(connectionUrl.port);
  if (
    !user ||
    !password ||
    !host ||
    !connectionUrl.port ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !database
  ) {
    throw new Error(
      "MIGRATION_DATABASE_URLにはusername・password・host・port・databaseをすべて明示してください。",
    );
  }

  return { database, host, password, port, user };
}

function readTlsFile(filePath) {
  if (!filePath) return undefined;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      "MIGRATION_DATABASE_URLのTLS証明書・鍵ファイルを読み取れません。",
    );
  }
}

function createTlsConfig(connectionUrl) {
  const sslMode = connectionUrl.searchParams.get("sslmode")?.toLowerCase();
  const sslNegotiation = connectionUrl.searchParams.get("sslnegotiation");
  const certificatePath = connectionUrl.searchParams.get("sslcert");
  const keyPath = connectionUrl.searchParams.get("sslkey");
  const rootCertificatePath = connectionUrl.searchParams.get("sslrootcert");
  const tlsEnabled =
    sslMode !== "disable" &&
    (sslMode !== undefined ||
      sslNegotiation === "direct" ||
      Boolean(certificatePath || keyPath || rootCertificatePath));
  if (!tlsEnabled) return false;

  return {
    rejectUnauthorized: true,
    ...(certificatePath ? { cert: readTlsFile(certificatePath) } : {}),
    ...(keyPath ? { key: readTlsFile(keyPath) } : {}),
    ...(rootCertificatePath ? { ca: readTlsFile(rootCertificatePath) } : {}),
  };
}

function createMigrationClientConfig(connectionUrl, connection) {
  return {
    ...connection,
    application_name: "emanowa-admin-provisioning",
    options: FIXED_SESSION_OPTIONS,
    client_encoding: "UTF8",
    replication: "false",
    sslnegotiation:
      connectionUrl.searchParams.get("sslnegotiation") ?? "postgres",
    ssl: createTlsConfig(connectionUrl),
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
    query_timeout: 10_000,
    idle_in_transaction_session_timeout: 8_000,
  };
}

function readCommand() {
  const argumentsAfterScript = process.argv.slice(2);
  if (argumentsAfterScript[0] === "--") argumentsAfterScript.shift();
  const [action, userId, ...rest] = argumentsAfterScript;
  if (
    rest.length > 0 ||
    (action !== "enable" && action !== "disable") ||
    !userId ||
    !UUID_V4_PATTERN.test(userId)
  ) {
    throw new Error(usage());
  }

  const rawUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URLを設定してください。通常API用接続は使用できません。",
    );
  }

  let connectionUrl;
  try {
    connectionUrl = new URL(rawUrl);
  } catch {
    throw new Error("MIGRATION_DATABASE_URLの形式を確認してください。");
  }
  if (hasUnsafeConnectionQuery(connectionUrl)) {
    throw new Error(
      "MIGRATION_DATABASE_URLのquery parameterは重複のないTLS設定だけを指定してください。接続先・role・password・timeoutは上書きできません。",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(connectionUrl.protocol) ||
    connectionUrl.hash
  ) {
    throw new Error("MIGRATION_DATABASE_URLの形式を確認してください。");
  }
  validateTransportSecurity(connectionUrl);
  const connection = parseRequiredConnection(connectionUrl);
  if (RESTRICTED_ROLES.has(connection.user.split(".", 1)[0] ?? "")) {
    throw new Error(
      "MIGRATION_DATABASE_URLには限定アプリロールではないmigration/DBA接続を指定してください。",
    );
  }

  return {
    action,
    userId: userId.toLowerCase(),
    enabled: action === "enable",
    clientConfig: createMigrationClientConfig(connectionUrl, connection),
  };
}

async function main() {
  const command = readCommand();
  const client = new Client(command.clientConfig);
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("begin");
    transactionStarted = true;

    const roleResult = await client.query(
      `select current_user as current_role,
              to_regrole('emanowa_admin_provisioner') is not null as provisioner_exists`,
    );
    const role = roleResult.rows[0];
    if (
      !role?.provisioner_exists ||
      typeof role.current_role !== "string" ||
      RESTRICTED_ROLES.has(role.current_role.split(".", 1)[0])
    ) {
      throw new Error("管理者台帳の更新に必要な限定ロールを確認できません。");
    }

    if (command.enabled) {
      const userResult = await client.query(
        `select exists (
           select 1
             from auth.users
            where id = $1::uuid
              and email_confirmed_at is not null
              and is_anonymous is false
              and deleted_at is null
              and (banned_until is null or banned_until <= now())
         ) as eligible`,
        [command.userId],
      );
      if (userResult.rows[0]?.eligible !== true) {
        throw new Error(
          "確認済みメールを持つ未削除・非banの非匿名ユーザーを確認できません。",
        );
      }
    }

    // Membership and the actor context exist only inside this transaction.
    // Neither application connection can execute this provisioning path.
    await client.query("grant emanowa_admin_provisioner to session_user");
    await client.query("set local role emanowa_admin_provisioner");
    await client.query("select set_config('app.actor_id', $1, true)", [
      command.userId,
    ]);
    if (command.enabled) {
      await client.query(
        `insert into app_private.admin_users (user_id, role, enabled)
         values ($1::uuid, 'moderator', true)
         on conflict (user_id) do update
           set enabled = true`,
        [command.userId],
      );
    } else {
      const disabled = await client.query(
        `update app_private.admin_users
            set enabled = false
          where user_id = $1::uuid`,
        [command.userId],
      );
      if (disabled.rowCount !== 1) {
        throw new Error("有効化済みの管理者台帳を確認できません。");
      }
    }
    await client.query("reset role");
    await client.query("revoke emanowa_admin_provisioner from session_user");
    await client.query("commit");
    transactionStarted = false;

    console.log(
      command.enabled
        ? "管理者アクセスを有効化しました。"
        : "管理者アクセスを無効化しました。",
    );
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback").catch(() => undefined);
    }
    if (error instanceof Error && error.message.startsWith("使い方:")) {
      throw error;
    }
    if (
      error instanceof Error &&
      (error.message.includes("MIGRATION_DATABASE_URL") ||
        error.message.includes("限定ロール") ||
        error.message.includes("非匿名ユーザー") ||
        error.message.includes("有効化済み"))
    ) {
      throw error;
    }
    throw new Error(
      "管理者台帳を更新できませんでした。migration接続と権限を確認してください。",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : usage());
  process.exitCode = 1;
});
