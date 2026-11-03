import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const WORLD_SLUG = "2027";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`✓ ${message}`);
}

function postgresCode(reason) {
  return reason && typeof reason === "object" ? reason.code : undefined;
}

function readLocalDatabaseUrl() {
  const binary = path.join(repositoryRoot, "node_modules", ".bin", "supabase");
  const output = execFileSync(binary, ["status", "--output", "json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const status = JSON.parse(output);
  return (
    status.DB_URL ??
    status.dbUrl ??
    status.db_url ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  );
}

function assertLocalOnly(rawUrl) {
  const environment = process.env.EMANOWA_ENVIRONMENT ?? "development";
  assert(
    environment !== "staging" && environment !== "production",
    "Stage H integration is local-only",
  );

  const url = new URL(rawUrl);
  assert(
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
      url.port === "54322" &&
      url.pathname === "/postgres",
    "Stage H integration accepts only the local Supabase database",
  );
}

function roleConnectionUrl(rawUrl, roleName, password) {
  const url = new URL(rawUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

function createBarrier(participants) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });

  return async function wait() {
    arrived += 1;
    if (arrived === participants) release();
    await ready;
  };
}

async function withContext(pool, actorId, authAssurance, operation) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("begin");
    transactionStarted = true;
    await client.query("select set_config('app.actor_id', $1, true)", [
      actorId ?? "",
    ]);
    await client.query("select set_config('app.lookup_public_id', '', true)");
    await client.query("select set_config('app.auth_aal', $1, true)", [
      authAssurance ?? "",
    ]);
    const result = await operation(client);
    await client.query("commit");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

function setWorldPosting(
  pool,
  adminId,
  {
    postingEnabled,
    expectedCurrent,
    idempotencyKey = randomUUID(),
    requestHash = randomBytes(32),
    barrier,
  },
) {
  return withContext(pool, adminId, "aal2", async (client) => {
    if (barrier) await barrier();
    const result = await client.query(
      `select * from app_private.set_world_posting(
         $1::text, $2::boolean, $3::text, $4::boolean, $5::uuid, $6::bytea
       )`,
      [
        WORLD_SLUG,
        postingEnabled,
        "incident",
        expectedCurrent,
        idempotencyKey,
        requestHash,
      ],
    );
    assert(result.rowCount === 1, "world operation must return one row");
    return result.rows[0];
  });
}

async function auditCount(migrationPool, adminId) {
  const result = await migrationPool.query(
    `select count(*)::integer as count
       from app_private.world_operation_audit as audit
       join app_private.worlds as world on world.id = audit.world_id
      where audit.admin_id = $1::uuid
        and world.slug = $2::text`,
    [adminId, WORLD_SLUG],
  );
  return result.rows[0]?.count;
}

async function installFixtures(migrationPool, adminId, ownerId) {
  await migrationPool.query("begin");
  try {
    await migrationPool.query(
      `insert into auth.users (
         id, aud, role, email, email_confirmed_at, created_at, updated_at
       ) values
         ($1::uuid, 'authenticated', 'authenticated', $2::text, now(), now(), now()),
         ($3::uuid, 'authenticated', 'authenticated', $4::text, now(), now(), now())
       on conflict (id) do nothing`,
      [
        adminId,
        `stage-h-admin-${adminId}@example.invalid`,
        ownerId,
        `stage-h-owner-${ownerId}@example.invalid`,
      ],
    );
    await migrationPool.query(
      `insert into app_private.admin_users (user_id, role, enabled)
       values ($1::uuid, 'moderator', true)
       on conflict (user_id) do update set enabled = true`,
      [adminId],
    );
    await migrationPool.query(
      `update app_private.worlds
          set state = 'open',
              posting_enabled = true,
              opens_at = transaction_timestamp() - interval '1 hour',
              closes_at = transaction_timestamp() + interval '1 year',
              updated_at = transaction_timestamp()
        where slug = $1::text`,
      [WORLD_SLUG],
    );
    await migrationPool.query("commit");
  } catch (error) {
    await migrationPool.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const rawDatabaseUrl = readLocalDatabaseUrl();
  assertLocalOnly(rawDatabaseUrl);

  const migrationUrl = new URL(rawDatabaseUrl);
  migrationUrl.username = "supabase_admin";
  const migrationPool = new Pool({
    connectionString: migrationUrl.toString(),
    max: 4,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(32).toString("base64url");
  const adminPassword = randomBytes(32).toString("base64url");
  const adminId = randomUUID();
  const ownerId = randomUUID();
  let appPool;
  let adminAppPool;
  let fixturesInstalled = false;
  let operationError;

  try {
    const identity = await migrationPool.query(
      "select current_user, current_setting('is_superuser') as superuser",
    );
    assert(
      identity.rows[0]?.current_user === "supabase_admin" &&
        identity.rows[0]?.superuser === "on",
      "fixture setup requires the local Supabase migration administrator",
    );

    const roles = await migrationPool.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         from pg_roles
        where rolname in ('emanowa_app', 'emanowa_admin_app')
        order by rolname`,
    );
    assert(roles.rowCount === 2, "Stage H application roles are missing");
    for (const role of roles.rows) {
      assert(!role.rolsuper, `${role.rolname} must not be superuser`);
      assert(!role.rolbypassrls, `${role.rolname} must not bypass RLS`);
      assert(!role.rolcreaterole, `${role.rolname} must not create roles`);
      assert(!role.rolcreatedb, `${role.rolname} must not create databases`);
    }

    await migrationPool.query(
      `alter role emanowa_app login password '${appPassword}'`,
    );
    await migrationPool.query(
      `alter role emanowa_admin_app login password '${adminPassword}'`,
    );
    appPool = new Pool({
      connectionString: roleConnectionUrl(
        rawDatabaseUrl,
        "emanowa_app",
        appPassword,
      ),
      max: 2,
      allowExitOnIdle: true,
    });
    adminAppPool = new Pool({
      connectionString: roleConnectionUrl(
        rawDatabaseUrl,
        "emanowa_admin_app",
        adminPassword,
      ),
      max: 4,
      allowExitOnIdle: true,
    });

    const [appIdentity, adminIdentity] = await Promise.all([
      appPool.query("select current_user"),
      adminAppPool.query("select current_user"),
    ]);
    assert(
      appIdentity.rows[0]?.current_user === "emanowa_app" &&
        adminIdentity.rows[0]?.current_user === "emanowa_admin_app",
      "normal and admin connections must use separate limited roles",
    );
    await installFixtures(migrationPool, adminId, ownerId);
    fixturesInstalled = true;
    passed("限定された通常/管理ロールとAAL2管理者fixtureを準備");

    const initialAuditCount = await auditCount(migrationPool, adminId);
    const differentKeyBarrier = createBarrier(2);
    const differentKeyRace = await Promise.allSettled([
      setWorldPosting(adminAppPool, adminId, {
        postingEnabled: false,
        expectedCurrent: true,
        barrier: differentKeyBarrier,
      }),
      setWorldPosting(adminAppPool, adminId, {
        postingEnabled: false,
        expectedCurrent: true,
        barrier: differentKeyBarrier,
      }),
    ]);
    const differentKeySuccesses = differentKeyRace.filter(
      (result) => result.status === "fulfilled",
    );
    const differentKeyConflicts = differentKeyRace.filter(
      (result) =>
        result.status === "rejected" && postgresCode(result.reason) === "P1009",
    );
    assert(
      differentKeySuccesses.length === 1 && differentKeyConflicts.length === 1,
      "concurrent different-key pauses must return one success and one P1009 conflict",
    );
    assert(
      (await auditCount(migrationPool, adminId)) === initialAuditCount + 1,
      "concurrent different-key pauses must append one audit row",
    );
    passed("別key・同一expectedの同時停止は成功1件/P1009 1件");

    await setWorldPosting(adminAppPool, adminId, {
      postingEnabled: true,
      expectedCurrent: false,
    });
    const beforeReplayAuditCount = await auditCount(migrationPool, adminId);
    const sharedKey = randomUUID();
    const sharedHash = randomBytes(32);
    const sameKeyBarrier = createBarrier(2);
    const sameKeyRace = await Promise.all([
      setWorldPosting(adminAppPool, adminId, {
        postingEnabled: false,
        expectedCurrent: true,
        idempotencyKey: sharedKey,
        requestHash: sharedHash,
        barrier: sameKeyBarrier,
      }),
      setWorldPosting(adminAppPool, adminId, {
        postingEnabled: false,
        expectedCurrent: true,
        idempotencyKey: sharedKey,
        requestHash: sharedHash,
        barrier: sameKeyBarrier,
      }),
    ]);
    assert(
      sameKeyRace.every((row) => row.posting_enabled === false) &&
        sameKeyRace.filter((row) => row.replayed === false).length === 1 &&
        sameKeyRace.filter((row) => row.replayed === true).length === 1,
      "same-key concurrent retries must return one original and one replay",
    );
    assert(
      (await auditCount(migrationPool, adminId)) === beforeReplayAuditCount + 1,
      "same-key concurrent retries must append exactly one audit row",
    );
    passed("同key・同bodyの同時再送は同じ結果で監査1件");

    let createError;
    try {
      await withContext(appPool, ownerId, "", (client) =>
        client.query(
          `select * from app_private.create_ema(
             $1::text, $2::integer, $3::integer, $4::text, $5::text,
             $6::text, $7::text, $8::text, $9::text, $10::uuid, $11::bytea
           )`,
          [
            WORLD_SLUG,
            987,
            654,
            "段階Hの停止境界を確認するテスト投稿",
            "段階H試験",
            "other",
            "basic_wood",
            "public",
            "public",
            randomUUID(),
            randomBytes(32),
          ],
        ),
      );
    } catch (error) {
      createError = error;
    }
    assert(
      postgresCode(createError) === "P1004",
      "a create started after the pause response must fail with P1004",
    );

    const publicWorld = await withContext(appPool, null, "", (client) =>
      client.query(
        "select accepting_posts from app_private.get_public_world($1::text)",
        [WORLD_SLUG],
      ),
    );
    assert(
      publicWorld.rows[0]?.accepting_posts === false,
      "public world must advertise acceptingPosts=false after pause",
    );
    passed("停止応答後の作成はP1004で拒否し、公開worldも受付停止を返す");

    console.log("Stage H local concurrency integration passed.");
  } catch (error) {
    operationError = error;
  } finally {
    const cleanupErrors = [];

    if (fixturesInstalled && adminAppPool) {
      try {
        const current = await withContext(
          adminAppPool,
          adminId,
          "aal2",
          (client) =>
            client.query(
              "select posting_enabled from app_private.get_admin_world_posting($1::text)",
              [WORLD_SLUG],
            ),
        );
        if (current.rows[0]?.posting_enabled === false) {
          await setWorldPosting(adminAppPool, adminId, {
            postingEnabled: true,
            expectedCurrent: false,
          });
        }
        passed("fixture worldの投稿受付状態を復元");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const pool of [appPool, adminAppPool]) {
      if (!pool) continue;
      try {
        await pool.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const role of ["emanowa_app", "emanowa_admin_app"]) {
      try {
        await migrationPool.query(`alter role ${role} nologin password null`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      const restoredRoles = await migrationPool.query(
        `select rolname, rolcanlogin, rolpassword
           from pg_authid
          where rolname in ('emanowa_app', 'emanowa_admin_app')
          order by rolname`,
      );
      assert(
        restoredRoles.rowCount === 2 &&
          restoredRoles.rows.every(
            (role) => role.rolcanlogin === false && role.rolpassword === null,
          ),
        "temporary application role logins were not fully revoked",
      );
      passed("一時LOGIN/passwordを破棄し通常/管理ロールをNOLOGINへ復元");
    } catch (error) {
      cleanupErrors.push(error);
    }

    try {
      await migrationPool.end();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        operationError ? [operationError, ...cleanupErrors] : cleanupErrors,
        "Stage H integration cleanup failed",
      );
    }
    if (operationError) throw operationError;
  }
}

await main();
