import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const WORLD_SLUG = "2027";
const RATE_LIMIT_SECRET = randomBytes(48).toString("base64url");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`✓ ${message}`);
}

function readLocalStatus() {
  const binary = path.join(repositoryRoot, "node_modules", ".bin", "supabase");
  return JSON.parse(
    execFileSync(binary, ["status", "--output", "json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
}

function pick(status, ...keys) {
  for (const key of keys) {
    if (typeof status[key] === "string" && status[key]) return status[key];
  }
  return null;
}

function assertLocalOnly(apiUrl, databaseUrl) {
  assert(
    !["staging", "production"].includes(
      (process.env.EMANOWA_ENVIRONMENT ?? "").toLowerCase(),
    ),
    "stage-g recovery is forbidden outside local test environments",
  );
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    localHosts.has(api.hostname) && localHosts.has(database.hostname),
    "stage-g recovery requires local Supabase and Postgres",
  );
  assert(
    database.port === "54322",
    "stage-g recovery requires the default local Postgres port 54322",
  );
}

function roleConnectionUrl(adminUrl, roleName, password) {
  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

function sqlPasswordLiteral(password) {
  return `'${password.replaceAll("'", "''")}'`;
}

async function withActor(pool, actorId, operation) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query("begin");
    started = true;
    await client.query("select set_config('app.actor_id', $1, true)", [
      actorId,
    ]);
    await client.query("select set_config('app.lookup_public_id', '', true)");
    const result = await operation(client);
    await client.query("commit");
    started = false;
    return result;
  } catch (error) {
    if (started) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function moderationRequestHash(entry) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        path: `/api/v1/admin/emas/${entry.publicId}/moderation`,
        method: "POST",
        body: {
          action: entry.action,
          reasonCode: entry.reasonCode,
          expectedVersion: entry.expectedVersion,
        },
      }),
      "utf8",
    )
    .digest();
}

async function replayPrivacyEntry(pool, adminId, entry) {
  const result = await withActor(pool, adminId, (client) =>
    client.query(
      `select * from app_private.moderate_ema(
         $1::uuid, $2::text, $3::text, $4::integer, $5::uuid, $6::bytea
       )`,
      [
        entry.publicId,
        entry.action,
        entry.reasonCode,
        entry.expectedVersion,
        entry.idempotencyKey,
        moderationRequestHash(entry),
      ],
    ),
  );
  assert(
    result.rowCount === 1,
    `privacy replay returned no row for ${entry.publicId}`,
  );
  return result.rows[0];
}

function validatePrivacyLedger(value) {
  assert(
    value?.schemaVersion === 1,
    "privacy replay ledger version is invalid",
  );
  assert(
    Array.isArray(value.entries) && value.entries.length > 0,
    "privacy replay ledger is empty",
  );
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  for (const entry of value.entries) {
    assert(uuidV4.test(entry.publicId), "privacy replay publicId is invalid");
    assert(
      uuidV4.test(entry.idempotencyKey),
      "privacy replay idempotency key is invalid",
    );
    assert(
      ["hide", "delete"].includes(entry.action),
      "privacy replay action must fail private",
    );
    assert(entry.reasonCode === "other", "privacy replay reason is invalid");
    assert(
      Number.isSafeInteger(entry.expectedVersion) && entry.expectedVersion >= 1,
      "privacy replay expected version is invalid",
    );
    assert(
      Object.keys(entry).sort().join(",") ===
        "action,expectedVersion,idempotencyKey,publicId,reasonCode",
      "privacy replay entry contains an unapproved field",
    );
  }
  return value;
}

function runPsql(databaseUrl, filePath) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  const host = decodeURIComponent(url.hostname).replace(/^\[(.+)\]$/u, "$1");
  const port = url.port;
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  assert(
    database && host && port && user && password,
    "restore URL is incomplete",
  );
  execFileSync(
    "psql",
    [
      "-X",
      "--set",
      "ON_ERROR_STOP=on",
      "--host",
      host,
      "--port",
      port,
      "--username",
      user,
      "--dbname",
      database,
      "--file",
      filePath,
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PGPASSWORD: password },
      stdio: "pipe",
    },
  );
}

async function stopChild(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    delay(5_000).then(() => server.child.kill("SIGKILL")),
  ]);
}

function startServer(nextBinary, port, environment) {
  let output = "";
  const child = spawn(
    nextBinary,
    ["start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-80_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return { child, logs: () => output };
}

async function waitForServer(server, baseUrl) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness.\n${server.logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/worlds/${WORLD_SLUG}`, {
        cache: "no-store",
      });
      if (response.status === 200) return;
    } catch {
      // The production server may not have bound the port yet.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready.\n${server.logs()}`);
}

async function verifyPublicPaths(baseUrl, targets) {
  const privateMarkers = targets.map((target) => target.wishText);
  for (const target of targets) {
    const paths = [
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}`,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/image?variant=og`,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/image?variant=square`,
    ];
    for (const pathname of paths) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        cache: "no-store",
      });
      const body = Buffer.from(await response.arrayBuffer()).toString("utf8");
      assert(
        response.status === 404,
        `${pathname} returned ${response.status} after replay`,
      );
      assert(
        response.headers.get("cache-control")?.includes("no-store"),
        `${pathname} was cacheable after replay`,
      );
      for (const marker of privateMarkers) {
        assert(
          !body.includes(marker),
          `${pathname} leaked restored content after replay`,
        );
      }
    }

    const htmlResponse = await fetch(
      `${baseUrl}/w/${WORLD_SLUG}/e/${target.publicId}`,
      { cache: "no-store" },
    );
    assert(
      htmlResponse.status === 404,
      `restored detail HTML returned ${htmlResponse.status}`,
    );
    assert(
      htmlResponse.headers.get("cache-control")?.includes("no-store"),
      "restored detail HTML was cacheable",
    );
    const html = await htmlResponse.text();
    for (const marker of privateMarkers) {
      assert(!html.includes(marker), "restored content leaked into HTML");
    }
  }

  const feedResponse = await fetch(
    `${baseUrl}/api/v1/worlds/${WORLD_SLUG}/emas?limit=50`,
    { cache: "no-store" },
  );
  assert(
    feedResponse.status === 200,
    "public feed was unavailable after replay",
  );
  assert(
    feedResponse.headers.get("cache-control")?.includes("no-store"),
    "public feed was cacheable after replay",
  );
  const feed = JSON.stringify(await feedResponse.json());
  const chunks = await Promise.all(
    targets.map(async (target) => {
      const response = await fetch(
        `${baseUrl}/api/v1/worlds/${WORLD_SLUG}/chunks?cx=${Math.floor(target.x / 20)}&cy=${Math.floor(target.y / 20)}`,
        { cache: "no-store" },
      );
      assert(
        response.status === 200,
        `public chunk was unavailable after replay: ${response.status}`,
      );
      assert(
        response.headers.get("cache-control")?.includes("no-store"),
        "public chunk was cacheable after replay",
      );
      return JSON.stringify(await response.json());
    }),
  );
  for (const [index, target] of targets.entries()) {
    const chunk = chunks[index];
    assert(
      !feed.includes(target.publicId),
      "restored target leaked into public feed",
    );
    assert(
      !chunk.includes(target.publicId),
      "restored target leaked into public chunk",
    );
    assert(
      !feed.includes(target.wishText),
      "restored content leaked into public feed",
    );
    assert(
      !chunk.includes(target.wishText),
      "restored content leaked into public chunk",
    );
  }
}

async function main() {
  const status = readLocalStatus();
  const apiUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    pick(status, "API_URL", "apiUrl", "api_url");
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    pick(status, "PUBLISHABLE_KEY", "ANON_KEY", "publishableKey", "anonKey");
  const rawDatabaseUrl =
    process.env.SUPABASE_LOCAL_DB_URL ??
    pick(status, "DB_URL", "dbUrl", "db_url") ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  assert(apiUrl, "Supabase API URL was not found; run pnpm supabase:start");
  assert(publishableKey, "Supabase publishable key was not found");
  assertLocalOnly(apiUrl, rawDatabaseUrl);

  const migrationUrl = new URL(rawDatabaseUrl);
  migrationUrl.username = "supabase_admin";
  const migrationDatabaseUrl = migrationUrl.toString();
  const adminPool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 2,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(32).toString("base64url");
  const adminAppPassword = randomBytes(32).toString("base64url");
  const databaseUrl = roleConnectionUrl(
    rawDatabaseUrl,
    "emanowa_app",
    appPassword,
  );
  const adminDatabaseUrl = roleConnectionUrl(
    rawDatabaseUrl,
    "emanowa_admin_app",
    adminAppPassword,
  );
  const supabaseBinary = path.join(
    repositoryRoot,
    "node_modules",
    ".bin",
    "supabase",
  );
  const nextBinary = path.join(repositoryRoot, "node_modules", ".bin", "next");
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "emanowa-stage-g-"),
  );
  const schemaPath = path.join(temporaryDirectory, "app-private-schema.sql");
  const dataPath = path.join(temporaryDirectory, "app-private-data.sql");
  const ledgerPath = path.join(temporaryDirectory, "privacy-replay.json");
  let adminAppPool;
  let server;

  try {
    const adminIdentity = await adminPool.query(
      `select id
       from auth.users
       where email_confirmed_at is not null
         and is_anonymous is false
         and deleted_at is null
       order by created_at
       limit 1`,
    );
    assert(
      adminIdentity.rowCount === 1,
      "no eligible recovery administrator fixture exists",
    );
    const adminId = adminIdentity.rows[0].id;
    await adminPool.query(
      `insert into app_private.admin_users (user_id, role, enabled)
       values ($1::uuid, 'moderator', true)
       on conflict (user_id) do update set enabled = true`,
      [adminId],
    );

    const targetResult = await adminPool.query(
      `select ema.public_id, ema.wish_text, ema.version, ema.x, ema.y
       from app_private.emas as ema
       where ema.status = 'active'
         and ema.visibility = 'public'
         and ema.message_visibility = 'public'
         and ema.wish_text is not null
         and ema.x between 300 and 399
         and ema.y between 300 and 399
         and not exists (
           select 1
           from app_private.emas as duplicate
           where duplicate.id <> ema.id
             and duplicate.wish_text = ema.wish_text
         )
       order by ema.created_at desc, ema.public_id desc
       limit 2`,
    );
    assert(
      targetResult.rowCount === 2,
      "stage-g recovery requires two active browser fixtures",
    );
    const targets = targetResult.rows.map((row, index) => ({
      publicId: row.public_id,
      wishText: row.wish_text,
      x: row.x,
      y: row.y,
      entry: {
        publicId: row.public_id,
        action: index === 0 ? "hide" : "delete",
        reasonCode: "other",
        expectedVersion: Number(row.version),
        idempotencyKey: randomUUID(),
      },
    }));
    const ledger = {
      schemaVersion: 1,
      generatedFor: "local-stage-g-recovery-test",
      entries: targets.map((target) => target.entry),
    };
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

    execFileSync(
      supabaseBinary,
      [
        "db",
        "dump",
        "--local",
        "--schema",
        "app_private",
        "--file",
        schemaPath,
      ],
      { cwd: repositoryRoot, stdio: "inherit" },
    );
    execFileSync(
      supabaseBinary,
      [
        "db",
        "dump",
        "--local",
        "--schema",
        "app_private",
        "--data-only",
        "--use-copy",
        "--file",
        dataPath,
      ],
      { cwd: repositoryRoot, stdio: "inherit" },
    );
    assert(
      (await readFile(schemaPath)).byteLength > 0,
      "schema backup is empty",
    );
    assert((await readFile(dataPath)).byteLength > 0, "data backup is empty");
    passed(
      "app_privateのschema/data論理バックアップと本文を含まない復旧台帳を作成",
    );

    await adminPool.query(
      `alter role emanowa_app login password ${sqlPasswordLiteral(appPassword)}`,
    );
    await adminPool.query(
      `alter role emanowa_admin_app login password ${sqlPasswordLiteral(adminAppPassword)}`,
    );
    adminAppPool = new Pool({
      connectionString: adminDatabaseUrl,
      max: 2,
      allowExitOnIdle: true,
    });
    for (const target of targets) {
      await replayPrivacyEntry(adminAppPool, adminId, target.entry);
    }
    const privateBeforeRestore = await adminPool.query(
      `select count(*)::integer as count
       from app_private.ema_public_projection
       where public_id = any($1::uuid[])`,
      [targets.map((target) => target.publicId)],
    );
    assert(
      privateBeforeRestore.rows[0].count === 0,
      "privacy actions did not remove public projections before restore",
    );
    await adminAppPool.end();
    adminAppPool = undefined;

    await adminPool.query("drop schema app_private cascade");
    runPsql(migrationDatabaseUrl, schemaPath);
    runPsql(migrationDatabaseUrl, dataPath);
    const exposedAfterRestore = await adminPool.query(
      `select count(*)::integer as count
       from app_private.ema_public_projection
       where public_id = any($1::uuid[])`,
      [targets.map((target) => target.publicId)],
    );
    assert(
      exposedAfterRestore.rows[0].count === targets.length,
      "older backup did not reproduce the privacy rollback fixture",
    );
    passed(
      "古いバックアップだけを戻すと後発の非表示・削除が巻き戻ることを隔離ローカルDBで再現",
    );

    const parsedLedger = validatePrivacyLedger(
      JSON.parse(await readFile(ledgerPath, "utf8")),
    );
    adminAppPool = new Pool({
      connectionString: adminDatabaseUrl,
      max: 2,
      allowExitOnIdle: true,
    });
    for (const entry of parsedLedger.entries) {
      await replayPrivacyEntry(adminAppPool, adminId, entry);
    }
    const restoredState = await adminPool.query(
      `select ema.public_id, ema.status, ema.wish_text,
              occupancy.ema_id is not null as occupied,
              projection.ema_id is not null as projected
       from app_private.emas as ema
       left join app_private.slot_occupancy as occupancy on occupancy.ema_id = ema.id
       left join app_private.ema_public_projection as projection on projection.ema_id = ema.id
       where ema.public_id = any($1::uuid[])
       order by ema.public_id`,
      [targets.map((target) => target.publicId)],
    );
    assert(restoredState.rowCount === 2, "privacy replay targets disappeared");
    const hidden = restoredState.rows.find((row) => row.status === "hidden");
    const deleted = restoredState.rows.find((row) => row.status === "deleted");
    assert(
      hidden && hidden.occupied && !hidden.projected,
      "hidden replay state is inconsistent",
    );
    assert(
      deleted &&
        !deleted.occupied &&
        !deleted.projected &&
        deleted.wish_text === null,
      "deleted replay state is inconsistent",
    );
    const audit = await adminPool.query(
      `select action
       from app_private.moderation_audit
       where ema_id in (
         select id from app_private.emas where public_id = any($1::uuid[])
       )
       order by action`,
      [targets.map((target) => target.publicId)],
    );
    assert(
      audit.rows.map((row) => row.action).join(",") === "delete,hide",
      "privacy replay audit is incomplete",
    );

    const port = 38_000 + Math.floor(Math.random() * 300);
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      APP_ORIGIN: baseUrl,
      DATABASE_URL: databaseUrl,
      ADMIN_DATABASE_URL: adminDatabaseUrl,
      EMANOWA_DATA_MODE: "database",
      EMANOWA_ENVIRONMENT: "test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      RATE_LIMIT_HMAC_SECRET: RATE_LIMIT_SECRET,
      NODE_ENV: "production",
    };
    delete environment.MIGRATION_DATABASE_URL;
    delete environment.SUPABASE_LOCAL_DB_URL;
    delete environment.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
    delete environment.SUPABASE_SERVICE_ROLE_KEY;
    server = startServer(nextBinary, port, environment);
    await waitForServer(server, baseUrl);
    await verifyPublicPaths(baseUrl, targets);
    passed(
      "復元後の再非公開化を監査付きで適用し、API・HTML・OG/PNG・一覧・chunkの非露出を確認",
    );
  } finally {
    await stopChild(server);
    if (adminAppPool) await adminAppPool.end().catch(() => undefined);
    await adminPool
      .query("alter role emanowa_app nologin password null")
      .catch(() => undefined);
    await adminPool
      .query("alter role emanowa_admin_app nologin password null")
      .catch(() => undefined);
    await adminPool.end();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
