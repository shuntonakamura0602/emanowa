import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

const validUserId = "00000000-0000-4000-8000-000000000000";
const scriptPath = path.join(process.cwd(), "scripts", "manage-admin.mjs");
type EnvironmentOverrides = Readonly<Record<string, string | undefined>>;

function runWithMigrationUrl(
  url: string,
  environment: EnvironmentOverrides = {},
) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--", "enable", validUserId],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment, MIGRATION_DATABASE_URL: url },
      timeout: 3_000,
    },
  );
}

function decodeStartupPacket(packet: Buffer): Record<string, string> {
  const fields = packet
    .subarray(8, packet.readInt32BE(0) - 1)
    .toString("utf8")
    .split("\0");
  const parameters: Record<string, string> = {};
  for (let index = 0; index + 1 < fields.length; index += 2) {
    parameters[fields[index]] = fields[index + 1];
  }
  return parameters;
}

async function captureStartupParameters(
  environment: EnvironmentOverrides,
): Promise<{
  parameters: Record<string, string>;
  status: number | null;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  const packet = new Promise<Buffer>((resolve, reject) => {
    server.once("connection", (socket) => {
      let received = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length < 4) return;
        const length = received.readInt32BE(0);
        if (received.length < length) return;
        resolve(received.subarray(0, length));
        socket.destroy();
      });
      socket.once("error", reject);
    });
  });

  const child = spawn(
    process.execPath,
    [scriptPath, "--", "enable", validUserId],
    {
      env: {
        ...process.env,
        ...environment,
        MIGRATION_DATABASE_URL: `postgresql://migration:validated-secret@127.0.0.1:${address.port}/emanowa`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const childClosed = once(child, "close");
  child.stderr?.setEncoding("utf8");
  child.stderr?.resume();

  let timeout: NodeJS.Timeout | undefined;
  try {
    const startupPacket = await Promise.race([
      packet,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("startup packet timeout")),
          3_000,
        );
      }),
    ]);
    const [status] = (await childClosed) as [number | null];
    return { parameters: decodeStartupPacket(startupPacket), status };
  } finally {
    if (timeout) clearTimeout(timeout);
    server.close();
    if (child.exitCode === null) child.kill();
  }
}

describe("manage-admin CLI transport boundary", () => {
  it("rejects a remote connection without an explicit TLS mode", () => {
    const result = runWithMigrationUrl(
      "postgresql://migration:secret@db.invalid/postgres",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sslmode=require");
  });

  it("rejects duplicate sslmode parameters instead of allowing last-value override", () => {
    const result = runWithMigrationUrl(
      "postgresql://migration:secret@db.invalid/postgres?sslmode=require&sslmode=disable",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("重複のないTLS設定");
  });

  it("rejects a query parameter that overrides a loopback authority host", () => {
    const result = runWithMigrationUrl(
      "postgresql://migration:secret@127.0.0.1/postgres?host=db.invalid&sslmode=disable",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TLS設定だけ");
  });

  it("rejects query parameters that override the bounded CLI timeouts", () => {
    const result = runWithMigrationUrl(
      "postgresql://migration:secret@db.invalid/postgres?sslmode=verify-full&statement_timeout=0&query_timeout=0",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("timeoutは上書きできません");
  });

  it.each(["no-verify", ""])(
    "rejects an unsafe loopback sslmode value %j",
    (sslMode) => {
      const result = runWithMigrationUrl(
        `postgresql://migration:secret@127.0.0.1:5432/postgres?sslmode=${sslMode}`,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("sslmodeはdisable、require");
    },
  );

  it.each([
    [
      "username",
      "postgresql://:secret@127.0.0.1:5432/postgres",
      { PGUSER: "migration" },
    ],
    [
      "password",
      "postgresql://migration:@127.0.0.1:5432/postgres",
      { PGPASSWORD: "secret" },
    ],
    [
      "host",
      "postgresql:///postgres?sslmode=verify-full",
      { PGHOST: "127.0.0.1" },
    ],
    [
      "port",
      "postgresql://migration:secret@127.0.0.1/postgres",
      { PGPORT: "5432" },
    ],
    [
      "database",
      "postgresql://migration:secret@127.0.0.1:5432/",
      { PGDATABASE: "postgres" },
    ],
  ])(
    "does not fill a missing %s from ambient PG settings",
    (_component, url, environment) => {
      const result = runWithMigrationUrl(url, environment);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "username・password・host・port・databaseをすべて明示",
      );
    },
  );

  it("uses only the validated structured config when ambient PG settings are hostile", async () => {
    const { parameters, status } = await captureStartupParameters({
      PGAPPNAME: "attacker-app",
      PGCLIENTENCODING: "SQL_ASCII",
      PGCLIENT_ENCODING: "SQL_ASCII",
      PGCONNECT_TIMEOUT: "999",
      PGDATABASE: "attacker_database",
      PGHOST: "db.invalid",
      PGOPTIONS: "-c role=postgres",
      PGPASSWORD: "attacker-secret",
      PGPORT: "1",
      PGREPLICATION: "database",
      PGSSLMODE: "no-verify",
      PGSSLNEGOTIATION: "direct",
      PGUSER: "postgres",
    });

    expect(status).toBe(1);
    expect(parameters).toMatchObject({
      application_name: "emanowa-admin-provisioning",
      database: "emanowa",
      idle_in_transaction_session_timeout: "8000",
      options: "-c standard_conforming_strings=on",
      replication: "false",
      statement_timeout: "8000",
      user: "migration",
    });
    expect(JSON.stringify(parameters)).not.toContain("attacker");
    expect(JSON.stringify(parameters)).not.toContain("role=postgres");
  }, 10_000);
});
