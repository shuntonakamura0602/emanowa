import { Client, type PoolConfig } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApplicationDatabasePoolConfig,
  validateDatabaseConnectionUrl,
  type ApplicationDatabaseRole,
  type ValidatedDatabaseConnection,
} from "@/server/config/database";

type ResolvedConnectionParameters = {
  application_name: string;
  client_encoding: string;
  connect_timeout: number;
  database: string;
  host: string;
  idle_in_transaction_session_timeout: number;
  options: string;
  password: string;
  port: number;
  query_timeout: number;
  replication: string;
  ssl: boolean | { rejectUnauthorized?: boolean };
  sslnegotiation: string;
  statement_timeout: number;
  user: string;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function requireValidatedConnection<Role extends ApplicationDatabaseRole>(
  connectionString: string,
  expectedRole: Role,
): ValidatedDatabaseConnection<Role> {
  const result = validateDatabaseConnectionUrl(connectionString, expectedRole);
  expect(result).toEqual(expect.objectContaining({ ok: true }));
  if (!result.ok) throw new Error(result.message);
  return result.connection;
}

function resolvePoolConfig(config: PoolConfig): ResolvedConnectionParameters {
  const client = new Client(config);
  return (
    client as unknown as {
      connectionParameters: ResolvedConnectionParameters;
    }
  ).connectionParameters;
}

describe("validateDatabaseConnectionUrl", () => {
  it.each([
    [
      "username",
      "postgresql://:secret@db.example.com:6543/emanowa?sslmode=verify-full",
    ],
    [
      "password",
      "postgresql://emanowa_app:@db.example.com:6543/emanowa?sslmode=verify-full",
    ],
    ["host", "postgresql:///emanowa?sslmode=verify-full"],
    [
      "port",
      "postgresql://emanowa_app:secret@db.example.com/emanowa?sslmode=verify-full",
    ],
    [
      "database",
      "postgresql://emanowa_app:secret@db.example.com:6543/?sslmode=verify-full",
    ],
  ])("requires an explicit %s", (_component, connectionString) => {
    const result = validateDatabaseConnectionUrl(
      connectionString,
      "emanowa_app",
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "invalid" }),
    );
  });

  it.each([
    ["host override", "host=attacker.example.com"],
    ["user override", "user=postgres"],
    ["password override", "password=attacker-secret"],
    ["port override", "port=1"],
    ["session options", "options=-c%20role%3Dpostgres"],
    ["connection timeout", "connect_timeout=0"],
    ["statement timeout", "statement_timeout=0"],
    ["query timeout", "query_timeout=0"],
  ])("rejects %s query parameters", (_label, query) => {
    const result = validateDatabaseConnectionUrl(
      `postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&${query}`,
      "emanowa_app",
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "invalid" }),
    );
  });

  it("rejects no-verify and duplicate TLS settings", () => {
    const noVerify = validateDatabaseConnectionUrl(
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=no-verify",
      "emanowa_app",
    );
    const duplicate = validateDatabaseConnectionUrl(
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&sslmode=require",
      "emanowa_app",
    );

    expect(noVerify).toEqual(
      expect.objectContaining({ ok: false, code: "invalid" }),
    );
    expect(duplicate).toEqual(
      expect.objectContaining({ ok: false, code: "invalid" }),
    );
  });

  it("requires an explicit safe sslmode for remote databases", () => {
    const result = validateDatabaseConnectionUrl(
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa",
      "emanowa_app",
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: "invalid" }),
    );
  });

  it("preserves explicit direct TLS negotiation", () => {
    const connection = requireValidatedConnection(
      "postgresql://emanowa_app:secret@db.example.com:6543/emanowa?sslmode=verify-full&sslnegotiation=direct",
      "emanowa_app",
    );
    const resolved = resolvePoolConfig(
      createApplicationDatabasePoolConfig(connection, "emanowa-bff"),
    );

    expect(resolved.sslnegotiation).toBe("direct");
    expect(resolved.ssl).toEqual(
      expect.objectContaining({ rejectUnauthorized: true }),
    );
  });
});

describe("createApplicationDatabasePoolConfig", () => {
  it("keeps the loopback development connection independent of ambient PG settings", () => {
    vi.stubEnv("PGSSLMODE", "no-verify");
    vi.stubEnv("PGSSLNEGOTIATION", "direct");
    const connection = requireValidatedConnection(
      "postgresql://emanowa_app:secret@localhost:5432/emanowa",
      "emanowa_app",
    );
    const poolConfig = createApplicationDatabasePoolConfig(
      connection,
      "emanowa-bff",
    );
    const resolved = resolvePoolConfig(poolConfig);

    expect(poolConfig.ssl).toBe(false);
    expect(resolved.ssl).toBe(false);
    expect(resolved.sslnegotiation).toBe("postgres");
  });

  it("does not allow ambient PG settings to replace the validated contract", () => {
    const hostileEnvironment = {
      PGAPPNAME: "attacker-app",
      PGCLIENTENCODING: "SQL_ASCII",
      PGCLIENT_ENCODING: "SQL_ASCII",
      PGCONNECT_TIMEOUT: "999",
      PGDATABASE: "attacker_database",
      PGHOST: "attacker.example.com",
      PGOPTIONS: "-c role=postgres",
      PGPASSWORD: "attacker-secret",
      PGPORT: "1",
      PGREPLICATION: "database",
      PGSSLMODE: "no-verify",
      PGSSLNEGOTIATION: "direct",
      PGUSER: "postgres",
    };
    for (const [key, value] of Object.entries(hostileEnvironment)) {
      vi.stubEnv(key, value);
    }

    const connection = requireValidatedConnection(
      "postgresql://emanowa_app.project-ref:validated-secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/emanowa?sslmode=verify-full",
      "emanowa_app",
    );
    const poolConfig = createApplicationDatabasePoolConfig(
      connection,
      "emanowa-bff",
    );
    const resolved = resolvePoolConfig(poolConfig);

    expect(poolConfig.connectionString).toBeUndefined();
    expect(resolved).toMatchObject({
      application_name: "emanowa-bff",
      client_encoding: "UTF8",
      connect_timeout: 5,
      database: "emanowa",
      host: "aws-0-ap-northeast-1.pooler.supabase.com",
      options: "-c standard_conforming_strings=on",
      password: "validated-secret",
      port: 6543,
      replication: "false",
      sslnegotiation: "postgres",
      user: "emanowa_app.project-ref",
    });
    expect(resolved.ssl).toEqual(
      expect.objectContaining({ rejectUnauthorized: true }),
    );
  });

  it.each([
    {
      applicationName: "emanowa-bff" as const,
      role: "emanowa_app" as const,
      username: "emanowa_app.project-ref",
    },
    {
      applicationName: "emanowa-admin-bff" as const,
      role: "emanowa_admin_app" as const,
      username: "emanowa_admin_app.project-ref",
    },
  ])(
    "keeps the validated $role pooler identity and fixed pool contract",
    ({ applicationName, role, username }) => {
      const connection = requireValidatedConnection(
        `postgresql://${username}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/emanowa?sslmode=verify-full`,
        role,
      );
      const poolConfig = createApplicationDatabasePoolConfig(
        connection,
        applicationName,
      );
      const resolved = resolvePoolConfig(poolConfig);

      expect(poolConfig).toMatchObject({
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
        query_timeout: 6_000,
        idle_in_transaction_session_timeout: 5_000,
        allowExitOnIdle: true,
      });
      expect(resolved).toMatchObject({
        application_name: applicationName,
        database: "emanowa",
        host: "aws-0-ap-northeast-1.pooler.supabase.com",
        port: 6543,
        user: username,
        statement_timeout: 5_000,
        query_timeout: 6_000,
        idle_in_transaction_session_timeout: 5_000,
      });
      expect(resolved.ssl).toBeTruthy();
      expect(resolved.ssl).not.toEqual(
        expect.objectContaining({ rejectUnauthorized: false }),
      );
    },
  );
});
