import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const WORLD_SLUG = "2027";
const OTHER_WORLD_SLUG = "2028";
const OWNER_ONLY_SECRET = `段階E-本人限定-${randomUUID()}`;
const HIDDEN_SECRET = `段階E-非表示-${randomUUID()}`;
const DELETED_SECRET = `段階E-削除済み-${randomUUID()}`;
const OTHER_WORLD_SECRET = `段階E-別年度-${randomUUID()}`;
const IMAGE_CHANGE_SECRET = `段階E-画像更新前-${randomUUID()}`;
const LONG_JAPANESE_EMOJI = `${"叶".repeat(30)}\n${"🌸".repeat(10)}${"家".repeat(39)}`;

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
    "stage-e integration fixtures are forbidden outside local test environments",
  );
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    localHosts.has(api.hostname) && localHosts.has(database.hostname),
    "stage-e integration fixtures require local Supabase and Postgres URLs",
  );
  assert(
    database.port === "54322",
    "stage-e integration fixtures require the default local Supabase Postgres port",
  );
}

function roleConnectionUrl(adminUrl, roleName, password) {
  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = password;
  return url.toString();
}

async function withContext(pool, actorId, operation) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query("begin");
    started = true;
    await client.query("select set_config('app.actor_id', $1, true)", [
      actorId ?? "",
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

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function createRequestHash(worldSlug, input) {
  return digest(
    JSON.stringify({
      path: `/api/v1/worlds/${worldSlug}/emas`,
      body: input,
    }),
  );
}

function mutationRequestHash(method, publicId, input) {
  return digest(
    JSON.stringify({
      path: `/api/v1/me/emas/${publicId}`,
      method,
      body: input,
    }),
  );
}

function createInput(x, y, overrides = {}) {
  return {
    x,
    y,
    wishText: `段階Eの願い ${x}-${y}`,
    nickname: "段階E",
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
    ...overrides,
  };
}

async function createEma(
  appPool,
  actorId,
  worldSlug,
  input,
  idempotencyKey = randomUUID(),
) {
  const result = await withContext(appPool, actorId, (client) =>
    client.query(
      `select * from app_private.create_ema(
        $1::text, $2::integer, $3::integer, $4::text, $5::text,
        $6::text, $7::text, $8::text, $9::text, $10::uuid, $11::bytea
      )`,
      [
        worldSlug,
        input.x,
        input.y,
        input.wishText,
        input.nickname ?? null,
        input.category,
        input.designId,
        input.visibility,
        input.messageVisibility,
        idempotencyKey,
        createRequestHash(worldSlug, input),
      ],
    ),
  );
  assert(result.rowCount === 1, "create_ema did not return a receipt");
  return result.rows[0];
}

function updateArguments(publicId, input, idempotencyKey) {
  return [
    publicId,
    input.expectedVersion,
    input.wishText !== undefined,
    input.wishText ?? null,
    input.nickname !== undefined,
    input.nickname ?? null,
    input.category !== undefined,
    input.category ?? null,
    input.designId !== undefined,
    input.designId ?? null,
    input.visibility !== undefined,
    input.visibility ?? null,
    input.messageVisibility !== undefined,
    input.messageVisibility ?? null,
    idempotencyKey,
    mutationRequestHash("PATCH", publicId, input),
  ];
}

async function updateEma(
  appPool,
  actorId,
  publicId,
  input,
  idempotencyKey = randomUUID(),
) {
  const result = await withContext(appPool, actorId, (client) =>
    client.query(
      `select * from app_private.update_ema(
        $1::uuid, $2::integer,
        $3::boolean, $4::text, $5::boolean, $6::text,
        $7::boolean, $8::text, $9::boolean, $10::text,
        $11::boolean, $12::text, $13::boolean, $14::text,
        $15::uuid, $16::bytea
      )`,
      updateArguments(publicId, input, idempotencyKey),
    ),
  );
  assert(result.rowCount === 1, "update_ema did not return a receipt");
  return result.rows[0];
}

async function deleteEma(
  appPool,
  actorId,
  publicId,
  expectedVersion,
  idempotencyKey = randomUUID(),
) {
  const body = { expectedVersion };
  const result = await withContext(appPool, actorId, (client) =>
    client.query(
      `select * from app_private.delete_ema(
        $1::uuid, $2::integer, $3::uuid, $4::bytea
      )`,
      [
        publicId,
        expectedVersion,
        idempotencyKey,
        mutationRequestHash("DELETE", publicId, body),
      ],
    ),
  );
  assert(result.rowCount === 1, "delete_ema did not return a receipt");
  return result.rows[0];
}

async function createFixtureUsers(apiUrl, serviceRoleKey, count) {
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return Promise.all(
    Array.from({ length: count }, async () => {
      const { data, error } = await client.auth.admin.createUser({
        email: `stage-e-${randomUUID()}@example.invalid`,
        email_confirm: true,
        password: randomBytes(18).toString("base64url"),
      });
      if (error) throw error;
      assert(data.user?.id, "fixture Auth user did not return a UID");
      return data.user.id;
    }),
  );
}

async function installFixtures({ adminPool, appPool, apiUrl, serviceRoleKey }) {
  await adminPool.query(
    "truncate table app_private.emas, app_private.world_chunks restart identity cascade",
  );
  await adminPool.query(
    `update app_private.worlds
     set state = 'open', posting_enabled = true,
         opens_at = transaction_timestamp() - interval '1 day',
         closes_at = transaction_timestamp() + interval '1 day'
     where slug = $1`,
    [WORLD_SLUG],
  );
  await adminPool.query(
    `insert into app_private.worlds (
       slug, name, state, posting_enabled, width, height, opens_at, closes_at
     ) values (
       $1, '2028年の統合試験用えまのわ', 'open', true, 1000, 1000,
       transaction_timestamp() - interval '1 day',
       transaction_timestamp() + interval '1 day'
     )
     on conflict (slug) do update
     set name = excluded.name, state = excluded.state,
         posting_enabled = excluded.posting_enabled,
         opens_at = excluded.opens_at, closes_at = excluded.closes_at`,
    [OTHER_WORLD_SLUG],
  );

  const owners = await createFixtureUsers(apiUrl, serviceRoleKey, 7);
  const ownerOnly = await createEma(
    appPool,
    owners[0],
    WORLD_SLUG,
    createInput(500, 500, {
      wishText: OWNER_ONLY_SECRET,
      nickname: "本人限定の絵馬",
      messageVisibility: "owner_only",
    }),
  );
  const unlisted = await createEma(
    appPool,
    owners[1],
    WORLD_SLUG,
    createInput(600, 600, {
      wishText: "URLを知る人にだけ見せる願い",
      nickname: "URL限定の絵馬",
      visibility: "unlisted",
    }),
  );
  const hidden = await createEma(
    appPool,
    owners[2],
    WORLD_SLUG,
    createInput(700, 700, {
      wishText: HIDDEN_SECRET,
      nickname: "非表示の絵馬",
    }),
  );
  await adminPool.query(
    `update app_private.emas
     set status = 'hidden', updated_at = transaction_timestamp(), version = version + 1
     where public_id = $1::uuid`,
    [hidden.public_id],
  );
  await adminPool.query(
    "delete from app_private.ema_public_projection where public_id = $1::uuid",
    [hidden.public_id],
  );

  const deleted = await createEma(
    appPool,
    owners[3],
    WORLD_SLUG,
    createInput(800, 800, {
      wishText: DELETED_SECRET,
      nickname: "削除する絵馬",
    }),
  );
  await deleteEma(appPool, owners[3], deleted.public_id, 1);

  const otherWorld = await createEma(
    appPool,
    owners[4],
    OTHER_WORLD_SLUG,
    createInput(550, 550, {
      wishText: OTHER_WORLD_SECRET,
      nickname: "別年度の絵馬",
    }),
  );
  const longEmoji = await createEma(
    appPool,
    owners[5],
    WORLD_SLUG,
    createInput(400, 400, {
      wishText: LONG_JAPANESE_EMOJI,
      nickname: "長文と絵文字",
    }),
  );
  const imageChange = await createEma(
    appPool,
    owners[6],
    WORLD_SLUG,
    createInput(450, 450, {
      wishText: IMAGE_CHANGE_SECRET,
      nickname: "公開範囲を変える絵馬",
    }),
  );

  return {
    owners,
    ownerOnlyPublicId: ownerOnly.public_id,
    unlistedPublicId: unlisted.public_id,
    hiddenPublicId: hidden.public_id,
    deletedPublicId: deleted.public_id,
    otherWorldPublicId: otherWorld.public_id,
    longEmojiPublicId: longEmoji.public_id,
    imageChangePublicId: imageChange.public_id,
  };
}

class BrowserSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  absorb(headers) {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      const first = value.split(";", 1)[0];
      const equals = first.indexOf("=");
      if (equals < 1) continue;
      const name = first.slice(0, equals);
      const cookieValue = first.slice(equals + 1);
      if (cookieValue) this.cookies.set(name, cookieValue);
      else this.cookies.delete(name);
    }
  }

  async request(pathname, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    if (options.method && options.method !== "GET") {
      headers.set("origin", this.baseUrl);
      headers.set("sec-fetch-site", "same-origin");
    }
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...options,
      headers,
      cache: "no-store",
    });
    this.absorb(response.headers);
    return response;
  }

  async post(pathname, body, extraHeaders = {}) {
    return this.request(pathname, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
  }
}

async function anonymous(browser) {
  const response = await browser.post("/api/v1/auth/anonymous", {});
  const body = await responseJson(response, "anonymous auth");
  assert(
    response.status === 200 && body.authenticated === true,
    `anonymous auth failed: ${JSON.stringify(body)}`,
  );
}

async function responseJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text}`);
  }
}

function assertNoStoreNoCookie(response, label) {
  assert(
    response.headers.get("cache-control")?.toLowerCase().includes("no-store"),
    `${label} must return Cache-Control: no-store`,
  );
  assert(
    !response.headers.has("set-cookie"),
    `${label} unexpectedly set an authentication cookie`,
  );
}

async function readJson(baseUrl, pathname, label, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  assertNoStoreNoCookie(response, label);
  const body = await responseJson(response, label);
  assert(
    response.status === expectedStatus,
    `${label} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return { response, body };
}

async function readText(
  baseUrl,
  pathname,
  label,
  { expectedStatus = 200, headers = {} } = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    cache: "no-store",
    headers,
  });
  assertNoStoreNoCookie(response, label);
  const text = await response.text();
  assert(
    response.status === expectedStatus,
    `${label} returned ${response.status}: ${text.slice(0, 300)}`,
  );
  return { response, text };
}

async function readImage(
  baseUrl,
  pathname,
  label,
  expectedWidth,
  expectedHeight,
) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: "no-store" });
  assertNoStoreNoCookie(response, label);
  assert(response.status === 200, `${label} returned ${response.status}`);
  assert(
    response.headers.get("content-type")?.startsWith("image/png"),
    `${label} did not return image/png`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    `${label} did not return a PNG signature`,
  );
  assert(bytes.readUInt32BE(16) === expectedWidth, `${label} width mismatch`);
  assert(bytes.readUInt32BE(20) === expectedHeight, `${label} height mismatch`);
  assert(
    Number(response.headers.get("content-length")) === bytes.byteLength,
    `${label} Content-Length mismatch`,
  );
  return bytes;
}

function assertError(result, code, label) {
  assert(result.body.error?.code === code, `${label} did not return ${code}`);
}

async function authUserCount(adminPool) {
  const result = await adminPool.query(
    "select count(*)::integer as count from auth.users",
  );
  return result.rows[0].count;
}

function assertCandidateOrder(result) {
  assert(
    result.body.candidates.length <= 8,
    "nearby returned over 8 candidates",
  );
  let previous = null;
  for (const candidate of result.body.candidates) {
    const dx = candidate.x - result.body.origin.x;
    const dy = candidate.y - result.body.origin.y;
    const current = {
      distanceSquared: dx * dx + dy * dy,
      slotNumber: candidate.slotNumber,
    };
    if (previous) {
      assert(
        current.distanceSquared > previous.distanceSquared ||
          (current.distanceSquared === previous.distanceSquared &&
            current.slotNumber > previous.slotNumber),
        "nearby candidates are not ordered by squared distance and slot number",
      );
    }
    previous = current;
  }
}

async function verifyPublicBoundaries({ adminPool, baseUrl, fixture }) {
  const before = await authUserCount(adminPool);
  const nearby = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${fixture.ownerOnlyPublicId}`,
    "nearby public invitation",
  );
  assert(
    nearby.body.origin.x === 500 && nearby.body.origin.y === 500,
    "nearby origin mismatch",
  );
  assert(
    nearby.body.candidates.length === 8,
    "nearby did not return 8 candidates",
  );
  assertCandidateOrder(nearby);
  assert(
    JSON.stringify(nearby.body).includes(OWNER_ONLY_SECRET) === false,
    "nearby response leaked owner-only content",
  );

  for (const [query, label] of [
    ["", "nearby missing origin"],
    [`?near=${fixture.ownerOnlyPublicId}&x=1&y=1`, "nearby mixed origin"],
    ["?x=1", "nearby partial coordinates"],
    ["?x=1&y=1&extra=1", "nearby unknown parameter"],
    ["?x=1&x=2&y=1", "nearby duplicate parameter"],
  ]) {
    const invalid = await readJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/nearby${query}`,
      label,
      400,
    );
    assertError(invalid, "INVALID_QUERY", label);
  }
  const coordinate = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?x=0&y=0`,
    "nearby coordinate corner",
  );
  assert(
    coordinate.body.candidates.every(
      (candidate) =>
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x < 1_000 &&
        candidate.y < 1_000,
    ),
    "nearby coordinate discovery returned an out-of-world candidate",
  );

  const unlistedNearby = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${fixture.unlistedPublicId}`,
    "unlisted exact nearby invitation",
  );
  assert(
    unlistedNearby.body.origin.x === 600 &&
      unlistedNearby.body.origin.y === 600,
    "unlisted exact invitation did not resolve",
  );
  for (const [publicId, label] of [
    [fixture.hiddenPublicId, "hidden nearby invitation"],
    [fixture.deletedPublicId, "deleted nearby invitation"],
    [fixture.otherWorldPublicId, "cross-world nearby invitation"],
  ]) {
    const missing = await readJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${publicId}`,
      label,
      404,
    );
    assertError(missing, "NOT_FOUND", label);
  }
  passed("nearbyの厳格クエリ・最大8件・決定順・限定公開・年度境界を確認");

  const ownerOnlyApi = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.ownerOnlyPublicId}`,
    "owner-only public API",
  );
  assert(
    ownerOnlyApi.body.ema.messageText === null,
    "owner-only public DTO must use null",
  );
  assert(
    !JSON.stringify(ownerOnlyApi.body).includes(OWNER_ONLY_SECRET),
    "owner-only public DTO leaked content",
  );
  const ownerOnlyHtml = await readText(
    baseUrl,
    `/w/${WORLD_SLUG}/e/${fixture.ownerOnlyPublicId}`,
    "owner-only HTML",
  );
  const ownerOnlyRsc = await readText(
    baseUrl,
    `/w/${WORLD_SLUG}/e/${fixture.ownerOnlyPublicId}?_rsc=stage-e`,
    "owner-only RSC",
    { headers: { RSC: "1" } },
  );
  for (const [text, label] of [
    [ownerOnlyHtml.text, "owner-only HTML"],
    [ownerOnlyRsc.text, "owner-only RSC"],
  ]) {
    assert(!text.includes(OWNER_ONLY_SECRET), `${label} leaked content`);
  }
  assert(
    ownerOnlyHtml.text.includes("本文をひみつにした絵馬"),
    "owner-only metadata did not use its fixed private description",
  );
  assert(
    ownerOnlyHtml.text.includes(
      `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.ownerOnlyPublicId}/image?variant=og`,
    ),
    "owner-only page is missing its OG image URL",
  );
  assert(
    ownerOnlyHtml.text.includes("https://x.com/intent/tweet") &&
      ownerOnlyHtml.text.includes(
        "https://social-plugins.line.me/lineit/share",
      ),
    "owner-only page is missing explicit X/LINE share destinations",
  );
  assert(
    !/(?:access_token|refresh_token|token=|code=)/iu.test(ownerOnlyHtml.text),
    "public detail included an authentication token-like query",
  );

  const unlistedApi = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.unlistedPublicId}`,
    "unlisted direct API",
  );
  assert(
    unlistedApi.body.ema.visibility === "unlisted" &&
      unlistedApi.body.ema.messageText === "URLを知る人にだけ見せる願い",
    "unlisted direct API did not preserve the direct-link contract",
  );
  const unlistedHtml = await readText(
    baseUrl,
    `/w/${WORLD_SLUG}/e/${fixture.unlistedPublicId}`,
    "unlisted direct HTML",
  );
  assert(unlistedHtml.text.includes("noindex"), "unlisted page is not noindex");
  assert(
    unlistedHtml.text.includes(
      `${baseUrl}/w/${WORLD_SLUG}/e/${fixture.unlistedPublicId}`,
    ),
    "unlisted page is missing a stable canonical URL",
  );
  const unlistedImageResponse = await fetch(
    `${baseUrl}/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.unlistedPublicId}/image?variant=og`,
    { cache: "no-store" },
  );
  assertNoStoreNoCookie(unlistedImageResponse, "unlisted OG image");
  if (unlistedImageResponse.status !== 200) {
    throw new Error(
      `unlisted OG image returned ${unlistedImageResponse.status}: ${await unlistedImageResponse.text()}`,
    );
  }
  assert(
    unlistedImageResponse.headers.get("x-robots-tag")?.includes("noimageindex"),
    "unlisted image is missing its crawler exclusion header",
  );
  await unlistedImageResponse.arrayBuffer();

  for (const [publicId, label] of [
    [fixture.hiddenPublicId, "hidden detail"],
    [fixture.deletedPublicId, "deleted detail"],
    [fixture.otherWorldPublicId, "cross-world detail"],
  ]) {
    const api = await readJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${publicId}`,
      `${label} API`,
      404,
    );
    assertError(api, "NOT_FOUND", `${label} API`);
    const page = await readText(
      baseUrl,
      `/w/${WORLD_SLUG}/e/${publicId}`,
      `${label} HTML`,
      { expectedStatus: 404 },
    );
    for (const marker of [HIDDEN_SECRET, DELETED_SECRET, OTHER_WORLD_SECRET]) {
      assert(!page.text.includes(marker), `${label} HTML leaked ${marker}`);
    }
  }
  const correctOtherWorld = await readJson(
    baseUrl,
    `/api/v1/worlds/${OTHER_WORLD_SLUG}/emas/${fixture.otherWorldPublicId}`,
    "correct other-world detail",
  );
  assert(
    correctOtherWorld.body.ema.worldSlug === OTHER_WORLD_SLUG,
    "other-world fixture did not resolve in its own world",
  );
  passed(
    "個別URL・owner_only・unlisted・hidden/deleted・別年度の公開境界を確認",
  );

  const ownerOnlyOg = await readImage(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.ownerOnlyPublicId}/image?variant=og`,
    "owner-only OG image",
    1_200,
    630,
  );
  assert(
    !ownerOnlyOg.includes(Buffer.from(OWNER_ONLY_SECRET)),
    "owner-only PNG contained the private marker bytes",
  );
  await readImage(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.ownerOnlyPublicId}/image?variant=square`,
    "owner-only square image",
    1_080,
    1_080,
  );
  await readImage(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.longEmojiPublicId}/image?variant=og`,
    "80-grapheme Japanese and emoji OG image",
    1_200,
    630,
  );
  const invalidImage = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.longEmojiPublicId}/image?variant=wide`,
    "invalid image variant",
    400,
  );
  assertError(invalidImage, "INVALID_QUERY", "invalid image variant");
  const deletedImage = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.deletedPublicId}/image?variant=og`,
    "deleted image",
    404,
  );
  assertError(deletedImage, "NOT_FOUND", "deleted image");
  passed("OG/正方形PNG・ローカル日本語フォント・80書記素・絵文字を確認");

  const inviteLanding = await readText(
    baseUrl,
    `/w/${WORLD_SLUG}/new?near=${fixture.ownerOnlyPublicId}`,
    "invite landing without session",
  );
  assert(
    inviteLanding.text.includes("友達の絵馬の近くに掛ける") &&
      inviteLanding.text.includes("近くの空き候補を8件"),
    "invite landing did not show the resolved invitation",
  );
  assert(
    inviteLanding.text.includes("noindex"),
    "invite landing is missing its crawler exclusion metadata",
  );
  assert(
    !inviteLanding.text.includes(OWNER_ONLY_SECRET),
    "invite landing leaked owner-only content",
  );
  const after = await authUserCount(adminPool);
  assert(after === before, "public Stage E GET routes created an Auth user");
  passed("共有・画像・招待の全公開GETはCookieと匿名Authユーザーを作らない");

  return nearby.body.candidates;
}

async function verifyImageInvalidation({ appPool, baseUrl, fixture }) {
  const pathName = `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.imageChangePublicId}/image?variant=og`;
  const before = await readImage(
    baseUrl,
    pathName,
    "image before privacy update",
    1_200,
    630,
  );
  const beforeHash = createHash("sha256").update(before).digest("hex");
  const update = await updateEma(
    appPool,
    fixture.owners[6],
    fixture.imageChangePublicId,
    { expectedVersion: 1, messageVisibility: "owner_only" },
  );
  assert(update.version === 2, "privacy update did not increment version");
  const publicAfter = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.imageChangePublicId}`,
    "detail after privacy update",
  );
  assert(
    publicAfter.body.ema.messageText === null &&
      !JSON.stringify(publicAfter.body).includes(IMAGE_CHANGE_SECRET),
    "updated public DTO retained its old public text",
  );
  const htmlAfter = await readText(
    baseUrl,
    `/w/${WORLD_SLUG}/e/${fixture.imageChangePublicId}`,
    "HTML after privacy update",
  );
  assert(
    !htmlAfter.text.includes(IMAGE_CHANGE_SECRET),
    "updated HTML/meta retained its old public text",
  );
  const after = await readImage(
    baseUrl,
    pathName,
    "image after privacy update",
    1_200,
    630,
  );
  const afterHash = createHash("sha256").update(after).digest("hex");
  assert(
    beforeHash !== afterHash,
    "same image URL returned stale pre-update bytes",
  );
  assert(
    !after.includes(Buffer.from(IMAGE_CHANGE_SECRET)),
    "updated PNG contained the old public marker bytes",
  );

  await deleteEma(
    appPool,
    fixture.owners[6],
    fixture.imageChangePublicId,
    update.version,
  );
  const afterDelete = await readJson(
    baseUrl,
    pathName,
    "same image URL after delete",
    404,
  );
  assertError(afterDelete, "NOT_FOUND", "same image URL after delete");
  passed("公開縮小と削除後に同一画像URLが古い本文・画像を返さない");
}

async function createThroughBrowser(browser, x, y, label) {
  const response = await browser.post(
    `/api/v1/worlds/${WORLD_SLUG}/emas`,
    createInput(x, y, {
      wishText: `${label}から掛けた願い`,
      nickname: label,
    }),
    { "idempotency-key": randomUUID() },
  );
  const body = await responseJson(response, label);
  return { response, body };
}

async function verifyInviteAndRaces({ baseUrl, fixture }) {
  const invitee = new BrowserSession(baseUrl);
  const landing = await invitee.request(
    `/w/${WORLD_SLUG}/new?near=${fixture.ownerOnlyPublicId}`,
  );
  assertNoStoreNoCookie(landing, "second-browser invite landing");
  assert(landing.status === 200, "second-browser invite landing failed");
  await landing.text();
  assert(invitee.cookies.size === 0, "invite landing created a session cookie");
  await anonymous(invitee);

  const nearby = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${fixture.ownerOnlyPublicId}`,
    "invite candidates before create",
  );
  const selected = nearby.body.candidates[0];
  const created = await createThroughBrowser(
    invitee,
    selected.x,
    selected.y,
    "別ブラウザーの招待",
  );
  assert(
    created.response.status === 201,
    `invite create returned ${created.response.status}: ${JSON.stringify(created.body)}`,
  );
  const createdPublicId = created.body.receipt.publicId;
  const [sourceDetail, inviteeDetail] = await Promise.all([
    readJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${fixture.ownerOnlyPublicId}`,
      "invite source after create",
    ),
    readJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${createdPublicId}`,
      "invitee detail after create",
    ),
  ]);
  assert(
    sourceDetail.body.ema.worldSlug === WORLD_SLUG &&
      inviteeDetail.body.ema.worldSlug === WORLD_SLUG,
    "invite source and invitee were not created in the same world",
  );
  const dx = sourceDetail.body.ema.x - inviteeDetail.body.ema.x;
  const dy = sourceDetail.body.ema.y - inviteeDetail.body.ema.y;
  assert(dx * dx + dy * dy <= 18, "invitee was not placed near its source");

  const owner = await invitee.request(`/api/v1/me/emas?world=${WORLD_SLUG}`);
  const ownerBody = await responseJson(owner, "invitee owner GET");
  assert(
    owner.status === 200 && ownerBody.ema?.publicId === createdPublicId,
    "invitee session did not retain ownership",
  );
  const freshCandidates = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${fixture.ownerOnlyPublicId}`,
    "candidates after invite create",
  );
  const second = freshCandidates.body.candidates[0];
  const ownerLimit = await createThroughBrowser(
    invitee,
    second.x,
    second.y,
    "同じ年の二枚目",
  );
  assert(
    ownerLimit.response.status === 409,
    "second owner ema must be rejected",
  );
  assertError(ownerLimit, "OWNER_LIMIT_REACHED", "second owner ema");
  passed("別ブラウザーの招待→匿名投稿→同一world内の位置関係と年1枚制約を確認");

  const racerA = new BrowserSession(baseUrl);
  const racerB = new BrowserSession(baseUrl);
  await Promise.all([anonymous(racerA), anonymous(racerB)]);
  const raceCandidates = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${fixture.ownerOnlyPublicId}`,
    "race candidates",
  );
  const contested = raceCandidates.body.candidates[0];
  const results = await Promise.all([
    createThroughBrowser(racerA, contested.x, contested.y, "同時投稿A"),
    createThroughBrowser(racerB, contested.x, contested.y, "同時投稿B"),
  ]);
  const winner = results.find((result) => result.response.status === 201);
  const loser = results.find((result) => result.response.status === 409);
  assert(winner, "same-slot race did not produce one winner");
  assert(loser, "same-slot race did not produce one conflict");
  assertError(loser, "SLOT_TAKEN", "same-slot race loser");
  const winnerDetail = await readJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${winner.body.receipt.publicId}`,
    "same-slot race winner detail",
  );
  assert(
    winnerDetail.body.ema.x === contested.x &&
      winnerDetail.body.ema.y === contested.y,
    "same-slot race persisted another coordinate",
  );
  passed("同一候補への同時投稿はDB制約で1件だけ確定し敗者へSLOT_TAKENを返す");
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
      const response = await fetch(`${baseUrl}/api/v1/worlds/${WORLD_SLUG}`, {
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
  const rawDatabaseUrl =
    process.env.SUPABASE_LOCAL_DB_URL ??
    pick(status, "DB_URL", "dbUrl", "db_url") ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  assert(apiUrl, "Supabase API URL was not found; run pnpm supabase:start");
  assert(publishableKey, "Supabase publishable key was not found");
  assert(serviceRoleKey, "Supabase local service role key was not found");
  assertLocalOnly(apiUrl, rawDatabaseUrl);

  const adminDatabaseUrl = new URL(rawDatabaseUrl);
  adminDatabaseUrl.username = "supabase_admin";
  const adminPool = new Pool({
    connectionString: adminDatabaseUrl.toString(),
    max: 4,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(24).toString("base64url");
  let appPool;
  let server;

  try {
    const fixtureRole = await adminPool.query(
      "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    assert(
      fixtureRole.rows[0]?.current_user === "supabase_admin" &&
        fixtureRole.rows[0].rolsuper &&
        fixtureRole.rows[0].rolbypassrls,
      "stage-e fixture setup requires the local Supabase migration administrator",
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
      rawDatabaseUrl,
      "emanowa_app",
      appPassword,
    );
    appPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      allowExitOnIdle: true,
    });
    const fixture = await installFixtures({
      adminPool,
      appPool,
      apiUrl,
      serviceRoleKey,
    });
    passed("ローカル限定の共有・公開範囲・年度境界fixtureを作成");

    const port = 33_000 + Math.floor(Math.random() * 700);
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
      RATE_LIMIT_HMAC_SECRET: "stage-e-local-integration-only",
      NODE_ENV: "production",
    };
    execFileSync(nextBinary, ["build"], {
      cwd: repositoryRoot,
      env: serverEnvironment,
      stdio: "inherit",
    });

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
      output = `${output}${chunk.toString()}`.slice(-40_000);
    };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    await waitForServer(server, baseUrl, () => output);

    try {
      await verifyPublicBoundaries({ adminPool, baseUrl, fixture });
      await verifyImageInvalidation({ appPool, baseUrl, fixture });
      await verifyInviteAndRaces({ baseUrl, fixture });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nNext.js logs:\n${output}`);
    }
  } finally {
    await stopChild(server);
    if (appPool) await appPool.end();
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
