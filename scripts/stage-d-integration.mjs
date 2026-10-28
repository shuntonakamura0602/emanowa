import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const FIXTURE_PUBLIC_COUNT = 1_000;
const FIXTURE_USER_COUNT = FIXTURE_PUBLIC_COUNT + 2;
const DENSE_CHUNK_COUNT = 400;
const EMPTY_WORLD_SLUG = "2097";
const OWNER_ONLY_MARKER = "段階D-本人限定-公開経路禁止";
const UNLISTED_MARKER = "段階D-URL限定-列挙禁止";
const HIDDEN_MARKER = "段階D-非表示-公開経路禁止";
const UNLISTED_NICKNAME = "URL限定の秘密名";
const HIDDEN_NICKNAME = "非表示の秘密名";
const PRIVATE_MARKERS = [
  OWNER_ONLY_MARKER,
  UNLISTED_MARKER,
  HIDDEN_MARKER,
  UNLISTED_NICKNAME,
  HIDDEN_NICKNAME,
];

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

function assertLocalOnly(apiUrl, databaseUrl) {
  assert(
    !["staging", "production"].includes(
      (process.env.EMANOWA_ENVIRONMENT ?? "").toLowerCase(),
    ),
    "stage-d integration fixtures are forbidden outside local test environments",
  );

  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    localHosts.has(api.hostname) && localHosts.has(database.hostname),
    "stage-d integration fixtures require local Supabase and Postgres URLs",
  );
  assert(
    database.port === "54322",
    "stage-d integration fixtures require the default local Supabase Postgres port",
  );
}

function roleConnectionUrl(adminUrl, roleName, password) {
  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

async function authUserCount(adminPool) {
  const result = await adminPool.query(
    "select count(*)::integer as count from auth.users",
  );
  return result.rows[0].count;
}

async function createFixtureUsers(apiUrl, serviceRoleKey) {
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const ids = [];
  const batchSize = 25;

  for (let offset = 0; offset < FIXTURE_USER_COUNT; offset += batchSize) {
    const count = Math.min(batchSize, FIXTURE_USER_COUNT - offset);
    const batch = await Promise.all(
      Array.from({ length: count }, async () => {
        const marker = randomUUID();
        const { data, error } = await client.auth.admin.createUser({
          email: `stage-d-${marker}@example.invalid`,
          email_confirm: true,
          password: randomBytes(18).toString("base64url"),
        });
        if (error) throw error;
        assert(data.user?.id, "fixture Auth user did not return a UID");
        return data.user.id;
      }),
    );
    ids.push(...batch);
  }

  assert(
    new Set(ids).size === FIXTURE_USER_COUNT,
    "fixture Auth users must have distinct UIDs",
  );
  return ids;
}

async function installFixture(adminPool, ownerIds) {
  const client = await adminPool.connect();
  let started = false;
  try {
    await client.query("begin");
    started = true;
    await client.query(
      "truncate table app_private.emas, app_private.world_chunks restart identity cascade",
    );
    await client.query(
      `update app_private.worlds
       set state = 'open', posting_enabled = true,
           opens_at = transaction_timestamp() - interval '1 day',
           closes_at = transaction_timestamp() + interval '1 day'
       where slug = '2027'`,
    );
    await client.query(
      `insert into app_private.worlds (
         slug, name, state, posting_enabled, width, height, opens_at, closes_at
       ) values (
         $1, '空の統合試験用世界', 'open', true, 1000, 1000,
         transaction_timestamp() - interval '1 day',
         transaction_timestamp() + interval '1 day'
       )
       on conflict (slug) do update
       set name = excluded.name, state = excluded.state,
           posting_enabled = excluded.posting_enabled,
           opens_at = excluded.opens_at, closes_at = excluded.closes_at`,
      [EMPTY_WORLD_SLUG],
    );

    await client.query(
      `with fixture as (
         select owner_id, (ordinality - 1)::integer as fixture_index
         from unnest($1::uuid[]) with ordinality as owners(owner_id, ordinality)
       ), positioned as (
         select
           owner_id,
           fixture_index,
           case
             when fixture_index < 400 then fixture_index % 20
             when fixture_index < 1000 then 100 + ((fixture_index - 400) % 30)
             when fixture_index = 1000 then 900
             else 901
           end as x,
           case
             when fixture_index < 400 then fixture_index / 20
             when fixture_index < 1000 then 100 + ((fixture_index - 400) / 30)
             else 900
           end as y
         from fixture
       )
       insert into app_private.emas (
         world_id, owner_id, x, y, wish_text, nickname, category,
         design_id, visibility, message_visibility, status,
         version, created_at, updated_at
       )
       select
         world.id,
         positioned.owner_id,
         positioned.x,
         positioned.y,
         case positioned.fixture_index
           when 0 then $2
           when 1000 then $3
           when 1001 then $4
           else '公開統合試験の願い ' || positioned.fixture_index::text
         end,
         case positioned.fixture_index
           when 1000 then $5
           when 1001 then $6
           else '統合試験 ' || positioned.fixture_index::text
         end,
         (array['family','health','study','work','love','challenge','other']::text[])
           [(positioned.fixture_index % 7) + 1],
         'basic_wood',
         case when positioned.fixture_index = 1000 then 'unlisted' else 'public' end,
         case when positioned.fixture_index = 0 then 'owner_only' else 'public' end,
         case when positioned.fixture_index = 1001 then 'hidden' else 'active' end,
         1,
         case positioned.fixture_index
           when 0 then date_trunc('second', transaction_timestamp()) + interval '0.123789 seconds'
           when 1 then date_trunc('second', transaction_timestamp()) + interval '0.123456 seconds'
           else date_trunc('second', transaction_timestamp()) - interval '1 second'
             - positioned.fixture_index * interval '1 millisecond'
         end,
         case positioned.fixture_index
           when 0 then date_trunc('second', transaction_timestamp()) + interval '0.123789 seconds'
           when 1 then date_trunc('second', transaction_timestamp()) + interval '0.123456 seconds'
           else date_trunc('second', transaction_timestamp()) - interval '1 second'
             - positioned.fixture_index * interval '1 millisecond'
         end
       from positioned
       cross join app_private.worlds as world
       where world.slug = '2027'`,
      [
        ownerIds,
        OWNER_ONLY_MARKER,
        UNLISTED_MARKER,
        HIDDEN_MARKER,
        UNLISTED_NICKNAME,
        HIDDEN_NICKNAME,
      ],
    );

    await client.query(
      `insert into app_private.ema_public_projection (
         ema_id, public_id, world_id, x, y, slot_number, nickname,
         category, design_id, visibility, message_visibility, message_text,
         version, created_at, updated_at
       )
       select
         ema.id, ema.public_id, ema.world_id, ema.x, ema.y, ema.slot_number,
         ema.nickname, ema.category, ema.design_id, ema.visibility,
         ema.message_visibility,
         case when ema.message_visibility = 'public' then ema.wish_text else null end,
         ema.version, ema.created_at, ema.updated_at
       from app_private.emas as ema
       join app_private.worlds as world on world.id = ema.world_id
       where world.slug = '2027' and ema.status = 'active'`,
    );
    await client.query(
      `insert into app_private.slot_occupancy (world_id, x, y, ema_id)
       select ema.world_id, ema.x, ema.y, ema.id
       from app_private.emas as ema
       join app_private.worlds as world on world.id = ema.world_id
       where world.slug = '2027' and ema.status in ('active', 'hidden')`,
    );
    await client.query(
      `insert into app_private.world_chunks (
         world_id, cx, cy, occupied_count, active_count, listed_count,
         revision, updated_at
       )
       select
         ema.world_id,
         ema.x / 20,
         ema.y / 20,
         count(*)::integer,
         count(*) filter (where ema.status = 'active')::integer,
         count(*) filter (
           where ema.status = 'active' and projection.visibility = 'public'
         )::integer,
         1,
         max(ema.updated_at)
       from app_private.emas as ema
       left join app_private.ema_public_projection as projection
         on projection.ema_id = ema.id
       join app_private.worlds as world on world.id = ema.world_id
       where world.slug = '2027' and ema.status in ('active', 'hidden')
       group by ema.world_id, ema.x / 20, ema.y / 20`,
    );

    const special = await client.query(
      `select public_id, visibility, status
       from app_private.emas
       where owner_id = any($1::uuid[])
         and (visibility = 'unlisted' or status = 'hidden')
       order by status`,
      [ownerIds],
    );
    await client.query("commit");
    started = false;

    const unlisted = special.rows.find((row) => row.visibility === "unlisted");
    const hidden = special.rows.find((row) => row.status === "hidden");
    assert(unlisted?.public_id, "unlisted fixture was not created");
    assert(hidden?.public_id, "hidden fixture was not created");
    return {
      unlistedPublicId: unlisted.public_id,
      hiddenPublicId: hidden.public_id,
    };
  } catch (error) {
    if (started) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertNoPrivateMarkers(text, label) {
  for (const marker of PRIVATE_MARKERS) {
    assert(!text.includes(marker), `${label} leaked private marker: ${marker}`);
  }
}

function assertPublicCache(response, label, allowOverviewCache = false) {
  assert(
    !response.headers.has("set-cookie"),
    `${label} unexpectedly set an authentication cookie`,
  );
  assert(
    response.headers.get("content-type")?.startsWith("application/json"),
    `${label} must return JSON`,
  );
  const cacheControl = response.headers.get("cache-control")?.toLowerCase();
  assert(cacheControl, `${label} did not return Cache-Control`);
  if (cacheControl.includes("no-store")) return;

  assert(allowOverviewCache, `${label} must be no-store`);
  const maxAgeValues = [
    ...cacheControl.matchAll(/(?:s-maxage|max-age)=(\d+)/gu),
  ].map((match) => Number(match[1]));
  assert(
    maxAgeValues.length > 0 && Math.max(...maxAgeValues) <= 30,
    `${label} overview cache must be at most 30 seconds`,
  );
}

async function readPublicJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  assertPublicCache(
    response,
    options.label ?? pathname,
    options.allowOverviewCache ?? false,
  );
  const text = await response.text();
  assertNoPrivateMarkers(text, options.label ?? pathname);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${options.label ?? pathname} returned invalid JSON`);
  }
  if (options.status !== undefined) {
    assert(
      response.status === options.status,
      `${options.label ?? pathname} returned ${response.status}: ${text}`,
    );
  }
  return {
    response,
    body,
    text,
    bytes: new TextEncoder().encode(text).byteLength,
  };
}

async function readPublicText(
  baseUrl,
  pathname,
  label,
  { headers = {}, expectedContentType = null } = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    cache: "no-store",
    headers,
  });
  assert(response.status === 200, `${label} returned ${response.status}`);
  assert(
    !response.headers.has("set-cookie"),
    `${label} unexpectedly set an authentication cookie`,
  );
  if (expectedContentType) {
    assert(
      response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith(expectedContentType),
      `${label} did not return ${expectedContentType}`,
    );
  }
  const text = await response.text();
  assertNoPrivateMarkers(text, label);
  return text;
}

function assertErrorCode(result, status, code, label) {
  assert(
    result.response.status === status,
    `${label} returned ${result.response.status}`,
  );
  assert(result.body.error?.code === code, `${label} did not return ${code}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}

async function waitForServer(child, baseUrl, logs) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness.\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/worlds/2027`, {
        cache: "no-store",
      });
      if (response.status === 200) return;
    } catch {
      // The production server may not have bound the port yet.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready.\n${logs()}`);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

async function measureEndpoint(
  baseUrl,
  pathname,
  label,
  { iterations = 15, allowOverviewCache = false } = {},
) {
  const durations = [];
  const sizes = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await readPublicJson(baseUrl, pathname, {
      status: 200,
      label,
      allowOverviewCache,
    });
    durations.push(performance.now() - startedAt);
    sizes.push(result.bytes);
  }
  const measurement = {
    iterations,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    maxBytes: Math.max(...sizes),
  };
  console.log(`METRIC ${label} ${JSON.stringify(measurement)}`);
  return measurement;
}

function sumCounts(cells) {
  return cells.reduce(
    (sum, cell) => ({
      occupiedCount: sum.occupiedCount + cell.occupiedCount,
      activeCount: sum.activeCount + cell.activeCount,
      listedCount: sum.listedCount + cell.listedCount,
    }),
    { occupiedCount: 0, activeCount: 0, listedCount: 0 },
  );
}

async function verifyPublicStageD({ adminPool, baseUrl, fixtureIds }) {
  const world = await readPublicJson(baseUrl, "/api/v1/worlds/2027", {
    status: 200,
    label: "world",
  });
  assert(
    world.body.stats.occupiedCount === 1_002,
    "world occupied count mismatch",
  );
  assert(world.body.stats.activeCount === 1_001, "world active count mismatch");
  assert(world.body.stats.listedCount === 1_000, "world listed count mismatch");

  const emptyOverview = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/${EMPTY_WORLD_SLUG}/overview?cellSize=20`,
    { status: 200, label: "empty overview", allowOverviewCache: true },
  );
  assert(
    emptyOverview.body.cells.length === 0,
    "empty world overview is not empty",
  );

  const overview20 = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/overview?cellSize=20",
    { status: 200, label: "overview 20", allowOverviewCache: true },
  );
  assert(
    overview20.body.cellSize === 20,
    "overview 20 returned another cell size",
  );
  assert(
    overview20.body.cells.length <= 2_500,
    "overview 20 exceeded its cell cap",
  );
  const dense20 = overview20.body.cells.find(
    (cell) => cell.x === 0 && cell.y === 0,
  );
  assert(
    dense20?.occupiedCount === 400,
    "overview 20 dense cell occupied count mismatch",
  );
  assert(
    dense20?.activeCount === 400,
    "overview 20 dense cell active count mismatch",
  );
  assert(
    dense20?.listedCount === 400,
    "overview 20 dense cell listed count mismatch",
  );
  assert(
    JSON.stringify(sumCounts(overview20.body.cells)) ===
      JSON.stringify({
        occupiedCount: 1_002,
        activeCount: 1_001,
        listedCount: 1_000,
      }),
    "overview 20 totals mismatch",
  );

  const overview100 = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/overview?cellSize=100",
    { status: 200, label: "overview 100", allowOverviewCache: true },
  );
  assert(
    overview100.body.cellSize === 100,
    "overview 100 returned another cell size",
  );
  assert(
    overview100.body.cells.length <= 100,
    "overview 100 exceeded its cell cap",
  );
  const dense100 = overview100.body.cells.find(
    (cell) => cell.x === 0 && cell.y === 0,
  );
  assert(dense100?.occupiedCount === 400, "overview 100 dense cell mismatch");
  assert(
    JSON.stringify(sumCounts(overview100.body.cells)) ===
      JSON.stringify({
        occupiedCount: 1_002,
        activeCount: 1_001,
        listedCount: 1_000,
      }),
    "overview 100 totals mismatch",
  );
  passed("20/100枠overviewは疎な集計と3種類の件数を一致させる");

  const invalidOverview = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/overview?cellSize=21",
    { label: "invalid overview" },
  );
  assertErrorCode(invalidOverview, 400, "INVALID_QUERY", "invalid overview");
  const missingOverview = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2096/overview?cellSize=20",
    { label: "missing overview" },
  );
  assertErrorCode(missingOverview, 404, "NOT_FOUND", "missing overview");

  const denseChunk = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/chunks?cx=0&cy=0",
    { status: 200, label: "dense chunk" },
  );
  assert(denseChunk.body.worldSlug === "2027", "chunk world mismatch");
  assert(
    denseChunk.body.cx === 0 && denseChunk.body.cy === 0,
    "chunk coordinate mismatch",
  );
  assert(
    Number.isSafeInteger(denseChunk.body.revision),
    "chunk revision is not a safe integer",
  );
  assert(denseChunk.body.revision >= 1, "chunk revision was not incremented");
  assert(
    denseChunk.body.cells.length === DENSE_CHUNK_COUNT,
    "dense chunk must contain 400 cells",
  );
  const ownerOnly = denseChunk.body.cells.find(
    (cell) =>
      cell.kind === "public" && cell.ema.messageVisibility === "owner_only",
  );
  assert(
    ownerOnly?.ema.messageText === null,
    "owner-only chunk text must be null",
  );
  assert(
    denseChunk.bytes < 4 * 1024 * 1024,
    "dense chunk exceeded the 4 MiB protection cap",
  );
  assert(
    denseChunk.bytes < 512 * 1024,
    "normal dense fixture exceeded the 512 KiB target",
  );

  const privateChunk = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/chunks?cx=45&cy=45",
    { status: 200, label: "private occupancy chunk" },
  );
  assert(
    privateChunk.body.cells.length === 2,
    "private occupancy chunk must contain two cells",
  );
  assert(
    privateChunk.body.cells.every(
      (cell) =>
        cell.kind === "occupied" &&
        Object.keys(cell).toSorted().join(",") === "kind,slotNumber,x,y",
    ),
    "unlisted/hidden chunk cells exposed fields beyond occupied coordinates",
  );
  assert(
    !privateChunk.text.includes(fixtureIds.unlistedPublicId),
    "unlisted ID leaked to chunk",
  );
  assert(
    !privateChunk.text.includes(fixtureIds.hiddenPublicId),
    "hidden ID leaked to chunk",
  );
  passed("400件chunk・revision・owner_only/unlisted/hidden公開境界を確認");

  const invalidChunk = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/chunks?cx=50&cy=0",
    { label: "invalid chunk" },
  );
  assertErrorCode(invalidChunk, 400, "INVALID_QUERY", "invalid chunk");
  const emptyChunk = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/${EMPTY_WORLD_SLUG}/chunks?cx=0&cy=0`,
    { status: 200, label: "empty chunk" },
  );
  assert(emptyChunk.body.revision === 0, "empty chunk revision must be zero");
  assert(emptyChunk.body.cells.length === 0, "empty chunk cells must be empty");
  const missingChunk = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2096/chunks?cx=0&cy=0",
    { label: "missing chunk" },
  );
  assertErrorCode(missingChunk, 404, "NOT_FOUND", "missing chunk");
  passed("空chunkと不存在worldをrevision=0/404で区別");

  const firstPage = await readPublicJson(baseUrl, "/api/v1/worlds/2027/emas", {
    status: 200,
    label: "feed default",
  });
  assert(firstPage.body.items.length === 24, "default feed limit must be 24");
  assert(
    typeof firstPage.body.nextCursor === "string",
    "feed did not return a cursor",
  );
  assert(
    firstPage.body.items.every((item) => item.visibility === "public"),
    "feed returned a non-public item",
  );
  assert(
    !firstPage.text.includes(fixtureIds.unlistedPublicId),
    "unlisted ID leaked to feed",
  );
  assert(
    !firstPage.text.includes(fixtureIds.hiddenPublicId),
    "hidden ID leaked to feed",
  );

  const secondPage = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/2027/emas?cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
    { status: 200, label: "feed second page" },
  );
  const firstIds = new Set(firstPage.body.items.map((item) => item.publicId));
  assert(
    secondPage.body.items.every((item) => !firstIds.has(item.publicId)),
    "keyset feed repeated an item across pages",
  );
  const firstMicrosecondPage = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/emas?limit=1",
    { status: 200, label: "microsecond feed first page" },
  );
  const secondMicrosecondPage = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/2027/emas?limit=1&cursor=${encodeURIComponent(firstMicrosecondPage.body.nextCursor)}`,
    { status: 200, label: "microsecond feed second page" },
  );
  assert(
    firstMicrosecondPage.body.items[0]?.publicId !==
      secondMicrosecondPage.body.items[0]?.publicId,
    "microsecond keyset repeated its first item",
  );
  assert(
    firstMicrosecondPage.body.items[0]?.createdAt ===
      secondMicrosecondPage.body.items[0]?.createdAt,
    "microsecond keyset skipped the second item inside the same millisecond",
  );
  const wrongWorldCursor = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/${EMPTY_WORLD_SLUG}/emas?cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
    { label: "feed cursor world mismatch" },
  );
  assertErrorCode(
    wrongWorldCursor,
    400,
    "INVALID_CURSOR",
    "feed cursor world mismatch",
  );

  const maxPage = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/emas?limit=50",
    { status: 200, label: "feed max limit" },
  );
  assert(
    maxPage.body.items.length === 50,
    "feed max limit must return 50 items",
  );
  const invalidLimit = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/emas?limit=51",
    { label: "feed invalid limit" },
  );
  assertErrorCode(invalidLimit, 400, "INVALID_QUERY", "feed invalid limit");

  const categoryPage = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/emas?limit=24&category=health",
    { status: 200, label: "category feed" },
  );
  assert(
    categoryPage.body.items.length === 24 &&
      categoryPage.body.items.every((item) => item.category === "health"),
    "category feed returned another category",
  );
  assert(
    typeof categoryPage.body.nextCursor === "string",
    "category feed did not return cursor",
  );
  const mismatchedCursor = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/2027/emas?cursor=${encodeURIComponent(categoryPage.body.nextCursor)}`,
    { label: "category cursor mismatch" },
  );
  assertErrorCode(
    mismatchedCursor,
    400,
    "INVALID_CURSOR",
    "category cursor mismatch",
  );
  const malformedCursor = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/2027/emas?category=health&cursor=${encodeURIComponent(`${categoryPage.body.nextCursor}.`)}`,
    { label: "malformed cursor" },
  );
  assertErrorCode(malformedCursor, 400, "INVALID_CURSOR", "malformed cursor");
  passed("一覧の24/50件・category・厳格keyset cursorを確認");

  for (let index = 0; index < 20; index += 1) {
    const random = await readPublicJson(
      baseUrl,
      "/api/v1/worlds/2027/emas/random?category=study",
      { status: 200, label: "random category" },
    );
    assert(
      random.body.item?.category === "study",
      "random returned another category",
    );
    assert(
      random.body.item.visibility === "public",
      "random returned unlisted item",
    );
  }
  const emptyRandom = await readPublicJson(
    baseUrl,
    `/api/v1/worlds/${EMPTY_WORLD_SLUG}/emas/random`,
    { status: 200, label: "empty random" },
  );
  assert(emptyRandom.body.item === null, "empty random must return null");
  const invalidRandom = await readPublicJson(
    baseUrl,
    "/api/v1/worlds/2027/emas/random?category=unknown",
    { label: "invalid random" },
  );
  assertErrorCode(invalidRandom, 400, "INVALID_QUERY", "invalid random");
  passed("randomはactive/public/categoryだけを対象にし空集合はnullを返す");

  const denseMetric = await measureEndpoint(
    baseUrl,
    "/api/v1/worlds/2027/chunks?cx=0&cy=0",
    "dense-chunk-400",
  );
  assert(
    denseMetric.maxBytes < 512 * 1024,
    "measured dense chunk exceeded 512 KiB",
  );
  await measureEndpoint(
    baseUrl,
    "/api/v1/worlds/2027/overview?cellSize=20",
    "overview-20-1002",
    { allowOverviewCache: true },
  );
  await measureEndpoint(
    baseUrl,
    "/api/v1/worlds/2027/emas?limit=50",
    "feed-50-of-1000",
  );

  await readPublicText(baseUrl, "/w/2027", "world HTML");
  await readPublicText(baseUrl, "/w/2027?_rsc=stage-d", "world RSC", {
    headers: { RSC: "1" },
    expectedContentType: "text/x-component",
  });
  passed("公開worldのHTML/RSCに非公開fixture文字列なし");

  const afterPublicGets = await authUserCount(adminPool);
  return afterPublicGets;
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
  assertLocalOnly(apiUrl, adminDatabaseUrl);

  const fixtureDatabaseUrl = new URL(adminDatabaseUrl);
  fixtureDatabaseUrl.username = "supabase_admin";
  const adminPool = new Pool({
    connectionString: fixtureDatabaseUrl.toString(),
    max: 4,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(24).toString("base64url");
  let server;

  try {
    const fixtureRole = await adminPool.query(
      "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    assert(
      fixtureRole.rows[0]?.current_user === "supabase_admin" &&
        fixtureRole.rows[0]?.rolsuper &&
        fixtureRole.rows[0]?.rolbypassrls,
      "stage-d fixture setup requires the local Supabase migration administrator",
    );
    const role = await adminPool.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = 'emanowa_app'",
    );
    assert(role.rowCount === 1, "emanowa_app role is missing");
    assert(!role.rows[0].rolsuper, "emanowa_app must not be superuser");
    assert(!role.rows[0].rolbypassrls, "emanowa_app must not bypass RLS");
    await adminPool.query(
      `alter role emanowa_app login password '${appPassword}'`,
    );
    const databaseUrl = roleConnectionUrl(
      adminDatabaseUrl,
      "emanowa_app",
      appPassword,
    );

    const ownerIds = await createFixtureUsers(apiUrl, serviceRoleKey);
    const fixtureIds = await installFixture(adminPool, ownerIds);
    passed("ローカル専用に公開1000件・密集400件・公開境界fixtureを作成");

    const port = 32_000 + Math.floor(Math.random() * 800);
    const baseUrl = `http://127.0.0.1:${port}`;
    const nextBinary = path.join(
      repositoryRoot,
      "node_modules",
      ".bin",
      "next",
    );
    const serverEnvironment = {
      ...process.env,
      APP_ORIGIN: baseUrl,
      DATABASE_URL: databaseUrl,
      EMANOWA_DATA_MODE: "database",
      EMANOWA_ENVIRONMENT: "test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NODE_ENV: "production",
    };

    execFileSync(nextBinary, ["build"], {
      cwd: repositoryRoot,
      env: serverEnvironment,
      stdio: "inherit",
    });
    const beforePublicGets = await authUserCount(adminPool);

    let output = "";
    server = spawn(
      nextBinary,
      ["start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: repositoryRoot,
        env: serverEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const collect = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-30_000);
    };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    await waitForServer(server, baseUrl, () => output);

    const afterPublicGets = await verifyPublicStageD({
      adminPool,
      baseUrl,
      fixtureIds,
    });
    assert(
      afterPublicGets === beforePublicGets,
      "public Stage D GET routes created an Auth user",
    );
    passed("全公開GETはCookieと匿名Authユーザーを作らない");
  } finally {
    await stopChild(server);
    await adminPool
      .query("alter role emanowa_app nologin password null")
      .catch(() => undefined);
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
