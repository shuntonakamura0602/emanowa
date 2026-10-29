import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`✓ ${message}`);
}

function readLocalStatus() {
  const binary = path.join(repositoryRoot, "node_modules", ".bin", "supabase");
  const output = execFileSync(binary, ["status", "--output", "json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function pick(status, ...keys) {
  for (const key of keys) {
    if (typeof status[key] === "string" && status[key]) return status[key];
  }
  return null;
}

function roleConnectionUrl(adminUrl, roleName, password) {
  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

async function withContext(pool, actorId, publicLookupId, operation) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query("begin");
    started = true;
    await client.query("select set_config('app.actor_id', $1, true)", [
      actorId ?? "",
    ]);
    await client.query("select set_config('app.lookup_public_id', $1, true)", [
      publicLookupId ?? "",
    ]);
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

function requestHash(worldSlug, input) {
  return createHash("sha256")
    .update(JSON.stringify({ path: `/worlds/${worldSlug}/emas`, body: input }))
    .digest();
}

async function createEma(pool, actorId, input, idempotencyKey = randomUUID()) {
  const hash = requestHash("2027", input);
  const result = await withContext(pool, actorId, null, (client) =>
    client.query(
      `select * from app_private.create_ema(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )`,
      [
        "2027",
        input.x,
        input.y,
        input.wishText,
        input.nickname ?? null,
        input.category,
        input.designId,
        input.visibility,
        input.messageVisibility,
        idempotencyKey,
        hash,
      ],
    ),
  );
  assert(result.rowCount === 1, "create_ema must return one receipt");
  return { ...result.rows[0], actorId, idempotencyKey, hash };
}

function inputAt(x, y, overrides = {}) {
  return {
    x,
    y,
    wishText: `統合試験の願い ${x}-${y}`,
    nickname: "統合試験",
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
    ...overrides,
  };
}

function postgresCode(reason) {
  return reason && typeof reason === "object" ? reason.code : undefined;
}

function settledCodes(results) {
  return results
    .map((result) =>
      result.status === "fulfilled"
        ? "fulfilled"
        : (postgresCode(result.reason) ?? "unknown"),
    )
    .join(", ");
}

async function expectPostgresCode(operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    assert(
      postgresCode(error) === expectedCode,
      `expected Postgres code ${expectedCode}, received ${postgresCode(error) ?? "unknown"}`,
    );
    return;
  }
  throw new Error(
    `expected Postgres code ${expectedCode}, but operation succeeded`,
  );
}

async function anonymousUser(apiUrl, publishableKey) {
  const client = createClient(apiUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  assert(data.user?.id, "anonymous auth did not return a UID");
  assert(data.user.is_anonymous === true, "auth user must be anonymous");
  return data.user.id;
}

async function createAdminUsers(apiUrl, serviceRoleKey, count) {
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const ids = [];
  for (let offset = 0; offset < count; offset += 20) {
    const batchSize = Math.min(20, count - offset);
    const batch = await Promise.all(
      Array.from({ length: batchSize }, async () => {
        const marker = randomUUID();
        const { data, error } = await client.auth.admin.createUser({
          email: `stage-b-${marker}@example.invalid`,
          email_confirm: true,
          password: randomBytes(18).toString("base64url"),
        });
        if (error) throw error;
        assert(data.user?.id, "admin auth user did not return a UID");
        return data.user.id;
      }),
    );
    ids.push(...batch);
  }
  return ids;
}

async function authUserCount(adminPool) {
  const result = await adminPool.query(
    "select count(*)::integer as count from auth.users",
  );
  return result.rows[0].count;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

async function waitForPublicRoute(child, baseUrl, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness.\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/worlds/2027`, {
        cache: "no-store",
      });
      if (response.status === 200) return response;
    } catch {
      // The development server may not have bound the port yet.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready.\n${logs()}`);
}

async function verifyHttpAuthBoundary({
  adminPool,
  apiUrl,
  publishableKey,
  databaseUrl,
}) {
  const port = 31_000 + Math.floor(Math.random() * 800);
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBinary = path.join(repositoryRoot, "node_modules", ".bin", "next");
  let output = "";
  const child = spawn(
    nextBinary,
    ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        APP_ORIGIN: baseUrl,
        DATABASE_URL: databaseUrl,
        EMANOWA_DATA_MODE: "database",
        EMANOWA_ENVIRONMENT: "test",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        NEXT_PUBLIC_SUPABASE_URL: apiUrl,
        RATE_LIMIT_HMAC_SECRET: "stage-b-local-integration-only",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    const beforeBrowse = await authUserCount(adminPool);
    const publicResponse = await waitForPublicRoute(
      child,
      baseUrl,
      () => output,
    );
    assert(
      publicResponse.headers.get("cache-control")?.includes("no-store"),
      "public API must be no-store",
    );
    assert(
      !publicResponse.headers.has("set-cookie"),
      "read-only browsing must not set an auth cookie",
    );
    const afterBrowse = await authUserCount(adminPool);
    assert(
      afterBrowse === beforeBrowse,
      "read-only browsing created an anonymous auth user",
    );
    passed("公開GETは匿名AuthユーザーもCookieも作らない");

    const first = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    assert(first.status === 200, `anonymous route returned ${first.status}`);
    const firstBody = await first.json();
    assert(
      firstBody.authenticated === true,
      "anonymous route did not authenticate",
    );
    const cookies =
      typeof first.headers.getSetCookie === "function"
        ? first.headers.getSetCookie()
        : [first.headers.get("set-cookie")].filter(Boolean);
    assert(cookies.length > 0, "anonymous route did not set a session cookie");
    const cookieHeader = cookies
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ");
    const afterFirst = await authUserCount(adminPool);
    assert(
      afterFirst === beforeBrowse + 1,
      "anonymous route must create exactly one user",
    );

    const second = await fetch(`${baseUrl}/api/v1/auth/anonymous`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    assert(
      second.status === 200,
      `anonymous session reuse returned ${second.status}`,
    );
    const afterSecond = await authUserCount(adminPool);
    assert(
      afterSecond === afterFirst,
      "existing session created a second auth user",
    );
    passed("匿名Auth routeは新規時だけ作成し既存Cookieを再利用する");

    const createInput = inputAt(650, 650, {
      wishText: "HTTP境界を通した段階Bの願い",
    });
    const createResponse = await fetch(`${baseUrl}/api/v1/worlds/2027/emas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        "idempotency-key": randomUUID(),
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(createInput),
    });
    const createResponseText = await createResponse.text();
    assert(
      createResponse.status === 201,
      `authenticated create route returned ${createResponse.status}: ${createResponseText}`,
    );
    const createBody = JSON.parse(createResponseText);
    const publicId = createBody.receipt?.publicId;
    assert(
      typeof publicId === "string" && publicId.length > 0,
      "create route did not return a public ID",
    );

    const ownerResponse = await fetch(`${baseUrl}/api/v1/me/emas?world=2027`, {
      headers: { cookie: cookieHeader },
    });
    assert(
      ownerResponse.status === 200,
      `owner route returned ${ownerResponse.status}`,
    );
    const ownerBody = await ownerResponse.json();
    assert(
      ownerBody.ema?.publicId === publicId,
      "owner route returned another ema",
    );
    assert(
      ownerBody.ema?.wishText === createInput.wishText,
      "owner route did not return the original wish",
    );

    const publicDetailResponse = await fetch(
      `${baseUrl}/api/v1/worlds/2027/emas/${publicId}`,
      { cache: "no-store" },
    );
    assert(
      publicDetailResponse.status === 200,
      `public detail route returned ${publicDetailResponse.status}`,
    );
    assert(
      !publicDetailResponse.headers.has("set-cookie"),
      "public detail unexpectedly set an auth cookie",
    );
    const publicBody = await publicDetailResponse.json();
    assert(
      publicBody.ema?.publicId === publicId,
      "public route returned another ema",
    );
    assert(
      publicBody.ema?.messageText === createInput.wishText,
      "public route did not return the public wish",
    );
    passed("匿名Cookieから投稿・本人取得・公開詳細までBFFを通して成功");
  } finally {
    await stopChild(child);
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
  const serviceRoleKey =
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
    pick(
      status,
      "SERVICE_ROLE_KEY",
      "SECRET_KEY",
      "serviceRoleKey",
      "secretKey",
    );
  const adminDatabaseUrl =
    process.env.SUPABASE_LOCAL_DB_URL ??
    pick(status, "DB_URL", "dbUrl", "db_url") ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  assert(apiUrl, "Supabase API URL was not found; run pnpm supabase:start");
  assert(
    publishableKey,
    "Supabase publishable key was not found; run pnpm supabase:start",
  );
  assert(
    serviceRoleKey,
    "Supabase local service role key was not found; run pnpm supabase:start",
  );

  const adminPool = new Pool({
    connectionString: adminDatabaseUrl,
    max: 4,
    allowExitOnIdle: true,
  });
  const localPassword = randomBytes(24).toString("base64url");
  const ownerPassword = randomBytes(24).toString("base64url");
  let appPool;
  let ownerPool;

  try {
    const role = await adminPool.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = 'emanowa_app'",
    );
    assert(role.rowCount === 1, "emanowa_app role is missing");
    assert(!role.rows[0].rolsuper, "emanowa_app must not be superuser");
    assert(!role.rows[0].rolbypassrls, "emanowa_app must not bypass RLS");
    await adminPool.query(
      `alter role emanowa_app login password '${localPassword}'`,
    );
    await adminPool.query(
      `alter role emanowa_owner login password '${ownerPassword}'`,
    );
    const databaseUrl = roleConnectionUrl(
      adminDatabaseUrl,
      "emanowa_app",
      localPassword,
    );
    appPool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      allowExitOnIdle: true,
    });
    ownerPool = new Pool({
      connectionString: roleConnectionUrl(
        adminDatabaseUrl,
        "emanowa_owner",
        ownerPassword,
      ),
      max: 1,
      allowExitOnIdle: true,
    });
    passed("BFF接続ロールは非所有者・NOSUPERUSER・NOBYPASSRLS");

    await ownerPool.query(
      `update app_private.worlds
       set state = 'open', posting_enabled = true,
           opens_at = now() - interval '1 day',
           closes_at = now() + interval '1 day'
       where slug = '2027'`,
    );

    const users = await Promise.all(
      Array.from({ length: 4 }, () => anonymousUser(apiUrl, publishableKey)),
    );
    assert(
      new Set(users).size === 4,
      "anonymous Auth sessions must have distinct UIDs",
    );
    passed("Supabase Authで4つの匿名セッションを別UIDとして発行");

    const sameSlot = await Promise.allSettled([
      createEma(appPool, users[0], inputAt(10, 10)),
      createEma(appPool, users[1], inputAt(10, 10)),
    ]);
    assert(
      sameSlot.filter((result) => result.status === "fulfilled").length === 1,
      `same slot race must have exactly one success (${settledCodes(sameSlot)})`,
    );
    assert(
      sameSlot
        .filter((result) => result.status === "rejected")
        .every((result) => postgresCode(result.reason) === "P1007"),
      "same slot loser must be SLOT_TAKEN",
    );
    passed("異なる匿名UIDの同一枠競合は成功1件");

    const sameOwner = await Promise.allSettled([
      createEma(appPool, users[2], inputAt(20, 20)),
      createEma(appPool, users[2], inputAt(21, 20)),
    ]);
    assert(
      sameOwner.filter((result) => result.status === "fulfilled").length === 1,
      `same owner race must have exactly one success (${settledCodes(sameOwner)})`,
    );
    assert(
      sameOwner
        .filter((result) => result.status === "rejected")
        .every((result) => postgresCode(result.reason) === "P1006"),
      "same owner loser must be OWNER_LIMIT_REACHED",
    );
    passed("同一匿名UIDの別枠競合は成功1件");

    const privateWish = "本人だけが読める固有文言-STAGE-B";
    const unlisted = await createEma(
      appPool,
      users[3],
      inputAt(30, 30, {
        wishText: privateWish,
        visibility: "unlisted",
        messageVisibility: "owner_only",
      }),
    );
    const detail = await withContext(
      appPool,
      null,
      unlisted.public_id,
      (client) =>
        client.query("select * from app_private.get_public_ema($1, $2)", [
          "2027",
          unlisted.public_id,
        ]),
    );
    assert(detail.rowCount === 1, "unlisted direct detail must be available");
    assert(
      detail.rows[0].message_text === null,
      "owner-only text leaked to detail",
    );
    const listed = await withContext(appPool, null, null, (client) =>
      client.query(
        "select * from app_private.list_public_emas($1, $2, $3, $4, $5)",
        ["2027", 50, null, null, null],
      ),
    );
    assert(
      !listed.rows.some((row) => row.public_id === unlisted.public_id),
      "unlisted ema leaked into public listing",
    );
    const chunk = await withContext(appPool, null, null, (client) =>
      client.query("select * from app_private.get_public_chunk($1, $2, $3)", [
        "2027",
        1,
        1,
      ]),
    );
    assert(
      !JSON.stringify(chunk.rows).includes(unlisted.public_id),
      "unlisted public ID leaked into chunk",
    );
    assert(
      !JSON.stringify(chunk.rows).includes(privateWish),
      "owner-only text leaked into chunk",
    );
    passed("unlisted/owner_onlyは直接詳細・一覧・chunkで公開境界を維持");

    const own = await withContext(appPool, users[3], null, (client) =>
      client.query("select * from app_private.get_owner_ema($1)", ["2027"]),
    );
    assert(
      own.rows[0]?.wish_text === privateWish,
      "owner could not read own text",
    );
    const stranger = await withContext(appPool, randomUUID(), null, (client) =>
      client.query("select * from app_private.get_owner_ema($1)", ["2027"]),
    );
    assert(
      stranger.rowCount === 0,
      "RLS allowed another actor to read owner text",
    );
    await expectPostgresCode(
      () =>
        withContext(appPool, users[3], null, (client) =>
          client.query(
            "select wish_text from app_private.emas where public_id = $1",
            [unlisted.public_id],
          ),
        ),
      "42501",
    );
    passed("別UIDは原本本文を取得できず本人だけ取得できる");

    const reusedClient = await appPool.connect();
    try {
      await reusedClient.query("begin");
      await reusedClient.query("select set_config('app.actor_id', $1, true)", [
        users[3],
      ]);
      const actorDuring = await reusedClient.query(
        "select app_private.current_actor_id() as actor_id",
      );
      assert(
        actorDuring.rows[0].actor_id === users[3],
        "actor context was not set",
      );
      await reusedClient.query("commit");
      await reusedClient.query("begin");
      const actorAfter = await reusedClient.query(
        "select app_private.current_actor_id() as actor_id",
      );
      assert(
        actorAfter.rows[0].actor_id === null,
        "actor context leaked after commit",
      );
      await reusedClient.query("commit");
    } finally {
      reusedClient.release();
    }
    passed("同じプール接続の次transactionへactor文脈を残さない");

    const raceActors = await createAdminUsers(apiUrl, serviceRoleKey, 100);
    const hundred = await Promise.allSettled(
      raceActors.map((actorId, index) =>
        createEma(
          appPool,
          actorId,
          inputAt(800, 800, { wishText: `100並行-${index}` }),
        ),
      ),
    );
    assert(
      hundred.filter((result) => result.status === "fulfilled").length === 1,
      "100-way slot race must have exactly one success",
    );
    assert(
      hundred.filter((result) => result.status === "rejected").length === 99,
      "100-way slot race must reject 99 requests",
    );
    assert(
      hundred
        .filter((result) => result.status === "rejected")
        .every((result) => postgresCode(result.reason) === "P1007"),
      `100-way slot race losers must all be SLOT_TAKEN (${settledCodes(hundred)})`,
    );
    const consistency = await adminPool.query(
      `select
         (select count(*)::integer from app_private.emas
          where world_id = w.id and x = 800 and y = 800 and status in ('active','hidden')) as ema_count,
         (select count(*)::integer from app_private.slot_occupancy
          where world_id = w.id and x = 800 and y = 800) as occupancy_count,
         (select count(*)::integer from app_private.ema_public_projection p
          where p.world_id = w.id and p.x = 800 and p.y = 800) as projection_count
       from app_private.worlds w where slug = '2027'`,
    );
    assert(
      JSON.stringify(consistency.rows[0]) ===
        JSON.stringify({
          ema_count: 1,
          occupancy_count: 1,
          projection_count: 1,
        }),
      "100-way race left an orphan or duplicate",
    );
    passed(
      "100件同時要求（最大20 DB接続）は成功1件・SLOT_TAKEN 99件で孤立行なし",
    );

    const raceWinner = hundred.find((result) => result.status === "fulfilled")
      ?.value.actorId;
    const replayActor = raceActors.find((actorId) => actorId !== raceWinner);
    assert(replayActor, "could not select a free actor for idempotency test");
    const replayInput = inputAt(700, 700);
    const replayKey = randomUUID();
    const replays = await Promise.all([
      createEma(appPool, replayActor, replayInput, replayKey),
      createEma(appPool, replayActor, replayInput, replayKey),
    ]);
    assert(
      replays[0].public_id === replays[1].public_id,
      "same idempotency request created two public IDs",
    );
    await expectPostgresCode(
      () => createEma(appPool, replayActor, inputAt(701, 700), replayKey),
      "P1005",
    );
    passed("同一冪等key/bodyは同じreceipt、別bodyは拒否");

    const directApi = await fetch(`${apiUrl}/rest/v1/emas?select=id`, {
      headers: {
        accept: "application/json",
        apikey: publishableKey,
        authorization: `Bearer ${publishableKey}`,
        "accept-profile": "app_private",
      },
    });
    assert(!directApi.ok, "app_private was exposed through the Data API");
    passed("app_privateはSupabase Data APIへ非公開");

    await verifyHttpAuthBoundary({
      adminPool,
      apiUrl,
      publishableKey,
      databaseUrl,
    });
  } finally {
    if (appPool) await appPool.end();
    if (ownerPool) await ownerPool.end();
    await adminPool
      .query("alter role emanowa_app nologin password null")
      .catch(() => undefined);
    await adminPool
      .query("alter role emanowa_owner nologin password null")
      .catch(() => undefined);
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
