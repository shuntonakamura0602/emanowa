import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const WORLD_SLUG = "2027";
const OTHER_WORLD_SLUG = "2028";
const XSS_WISH = '<script id="stage-f-xss">globalThis.stageFXss=true</script>';
const REPORT_DETAIL = '<img src=x onerror="globalThis.stageFReport=true">';
const TARGET_CATEGORY = "health";
const TARGET_NICKNAME = "markup文字列";
const RATE_LIMIT_SECRET = randomBytes(48).toString("base64url");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`✓ ${message}`);
}

function assertTextExcludesSecrets(value, secrets, label) {
  for (const secret of secrets) {
    assert(!value.includes(secret), `${label} leaked a server-only secret`);
  }
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(target)));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
}

async function assertStaticAssetsExcludeSecrets(secrets) {
  const staticRoot = path.join(repositoryRoot, ".next", "static");
  const files = await listFilesRecursively(staticRoot);
  assert(files.length > 0, "Next.js build did not produce static assets");
  for (const file of files) {
    const contents = await readFile(file);
    for (const secret of secrets) {
      assert(
        !contents.includes(Buffer.from(secret)),
        `.next/static leaked a server-only secret in ${path.relative(repositoryRoot, file)}`,
      );
    }
  }
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
    "stage-f integration fixtures are forbidden outside local test environments",
  );
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    localHosts.has(api.hostname) && localHosts.has(database.hostname),
    "stage-f integration fixtures require local Supabase and Postgres URLs",
  );
  assert(
    database.port === "54322",
    "stage-f integration fixtures require the default local Supabase Postgres port",
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

function rateLimitSubjectHash(action, subject) {
  return createHmac("sha256", RATE_LIMIT_SECRET)
    .update("emanowa-rate-limit-v1\0", "utf8")
    .update(action, "utf8")
    .update("\0", "utf8")
    .update(subject, "utf8")
    .digest();
}

function createRequestHash(worldSlug, input) {
  return digest(
    JSON.stringify({
      path: `/api/v1/worlds/${worldSlug}/emas`,
      body: {
        x: input.x,
        y: input.y,
        wishText: input.wishText,
        nickname: input.nickname ?? null,
        category: input.category,
        designId: input.designId,
        visibility: input.visibility,
        messageVisibility: input.messageVisibility,
      },
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
    wishText: `段階Fの願い ${x}-${y}`,
    nickname: "段階F",
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

function createServiceClient(apiUrl, serviceRoleKey) {
  return createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function createRegisteredIdentity(serviceClient, label, metadata = {}) {
  const email = `stage-f-${label}-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: metadata,
  });
  if (error)
    throw new Error(`${label} Auth user creation failed: ${error.message}`);
  assert(data.user?.id, `${label} Auth user did not return a UID`);
  return { id: data.user.id, email, password };
}

class BrowserSession {
  constructor(baseUrl, cookies = new Map()) {
    this.baseUrl = baseUrl;
    this.cookies = cookies;
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

  cookieMethods() {
    return {
      getAll: () => [...this.cookies].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          if (value) this.cookies.set(name, value);
          else this.cookies.delete(name);
        }
      },
    };
  }

  async requestAt(baseUrl, pathname, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    if (options.method && options.method !== "GET") {
      headers.set("origin", baseUrl);
      headers.set("sec-fetch-site", "same-origin");
    }
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      cache: "no-store",
    });
    this.absorb(response.headers);
    return response;
  }

  request(pathname, options = {}) {
    return this.requestAt(this.baseUrl, pathname, options);
  }

  jsonAt(baseUrl, method, pathname, body, extraHeaders = {}) {
    return this.requestAt(baseUrl, pathname, {
      method,
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  postAt(baseUrl, pathname, body, extraHeaders = {}) {
    return this.jsonAt(baseUrl, "POST", pathname, body, extraHeaders);
  }

  post(pathname, body, extraHeaders = {}) {
    return this.postAt(this.baseUrl, pathname, body, extraHeaders);
  }

  patch(pathname, body, extraHeaders = {}) {
    return this.jsonAt(this.baseUrl, "PATCH", pathname, body, extraHeaders);
  }
}

async function responseJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned non-JSON (${response.status}): ${text.slice(0, 500)}`,
    );
  }
}

async function expectJson(response, label, expectedStatus) {
  const body = await responseJson(response, label);
  assert(
    response.status === expectedStatus,
    `${label} returned ${response.status}: ${JSON.stringify(body)}`,
  );
  return { response, body };
}

function assertError(result, code, label) {
  assert(
    result.body.error?.code === code,
    `${label} did not return ${code}: ${JSON.stringify(result.body)}`,
  );
}

function assertRetryAfter(result, label) {
  const header = Number(result.response.headers.get("retry-after"));
  const body = result.body.error?.retryAfterSeconds;
  assert(
    Number.isSafeInteger(header) && header >= 1,
    `${label} lacks Retry-After`,
  );
  assert(header === body, `${label} Retry-After header/body mismatch`);
}

function assertNoStoreNoCookie(response, label) {
  assert(
    response.headers.get("cache-control")?.toLowerCase().includes("no-store"),
    `${label} must return Cache-Control: no-store`,
  );
  assert(
    !response.headers.has("set-cookie"),
    `${label} unexpectedly set a cookie`,
  );
}

async function publicJson(
  baseUrl,
  pathname,
  label,
  expectedStatus = 200,
  headers = {},
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    cache: "no-store",
    headers: { accept: "application/json", ...headers },
  });
  assertNoStoreNoCookie(response, label);
  return expectJson(response, label, expectedStatus);
}

async function anonymous(browser, baseUrl = browser.baseUrl) {
  const result = await expectJson(
    await browser.postAt(baseUrl, "/api/v1/auth/anonymous", {}),
    "anonymous auth",
    200,
  );
  assert(
    result.body.authenticated === true,
    "anonymous auth was not established",
  );
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replaceAll(/[^A-Z2-7]/gu, "");
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    assert(index >= 0, "TOTP secret was not base32");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digestBytes = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = digestBytes.at(-1) & 0x0f;
  const number = (digestBytes.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

function createSsrAuthClient(apiUrl, publishableKey, browser) {
  return createServerClient(apiUrl, publishableKey, {
    cookies: browser.cookieMethods(),
  });
}

async function signInRegistered(
  apiUrl,
  publishableKey,
  baseUrl,
  identity,
  label,
) {
  const browser = new BrowserSession(baseUrl);
  const client = createSsrAuthClient(apiUrl, publishableKey, browser);
  const signedIn = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  if (signedIn.error) {
    throw new Error(
      `${label} password sign-in failed: ${signedIn.error.message}`,
    );
  }
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    throw new Error(`${label} AAL lookup failed: ${assurance.error.message}`);
  }
  assert(
    assurance.data.currentLevel === "aal1",
    `${label} password session did not start at aal1`,
  );
  return { browser, client };
}

async function promoteToAal2(client, label) {
  const enrolled = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `stage-f-${label}-${randomUUID()}`,
  });
  if (enrolled.error) {
    throw new Error(
      `${label} TOTP enrollment failed: ${enrolled.error.message}`,
    );
  }
  assert(
    enrolled.data?.id && enrolled.data.totp?.secret,
    `${label} TOTP enrollment was incomplete`,
  );
  const challenged = await client.auth.mfa.challenge({
    factorId: enrolled.data.id,
  });
  if (challenged.error) {
    throw new Error(
      `${label} TOTP challenge failed: ${challenged.error.message}`,
    );
  }
  const verified = await client.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenged.data.id,
    code: currentTotp(enrolled.data.totp.secret),
  });
  if (verified.error) {
    throw new Error(
      `${label} TOTP verification failed: ${verified.error.message}`,
    );
  }
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    throw new Error(
      `${label} promoted AAL lookup failed: ${assurance.error.message}`,
    );
  }
  assert(
    assurance.data.currentLevel === "aal2",
    `${label} session was not promoted to aal2`,
  );
}

async function authUserCount(adminPool) {
  const result = await adminPool.query(
    "select count(*)::integer as count from auth.users",
  );
  return result.rows[0].count;
}

async function installFixtures({
  adminPool,
  appPool,
  serviceClient,
  identities,
}) {
  await adminPool.query(
    `truncate table
       app_private.moderation_audit,
       app_private.admin_users,
       app_private.rate_limit_buckets,
       app_private.idempotency_records,
       app_private.emas,
       app_private.world_chunks
     restart identity cascade`,
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
       $1, '2028年の段階F統合試験', 'open', true, 1000, 1000,
       transaction_timestamp() - interval '1 day',
       transaction_timestamp() + interval '1 day'
     )
     on conflict (slug) do update
     set name = excluded.name, state = excluded.state,
         posting_enabled = excluded.posting_enabled,
         opens_at = excluded.opens_at, closes_at = excluded.closes_at`,
    [OTHER_WORLD_SLUG],
  );

  const directOwners = [];
  for (const label of ["hidden-owner", "deleted-owner", "other-owner"]) {
    directOwners.push(await createRegisteredIdentity(serviceClient, label));
  }

  const hidden = await createEma(
    appPool,
    directOwners[0].id,
    WORLD_SLUG,
    createInput(110, 110, { wishText: `段階F-hidden-${randomUUID()}` }),
  );
  await adminPool.query(
    `with target as (
       update app_private.emas
       set status = 'hidden', version = version + 1,
           updated_at = transaction_timestamp()
       where public_id = $1::uuid
       returning world_id, x, y, visibility
     ), removed as (
       delete from app_private.ema_public_projection
       where public_id = $1::uuid
     )
     update app_private.world_chunks as chunk
     set active_count = chunk.active_count - 1,
         listed_count = chunk.listed_count - case when target.visibility = 'public' then 1 else 0 end,
         revision = chunk.revision + 1,
         updated_at = transaction_timestamp()
     from target
     where chunk.world_id = target.world_id
       and chunk.cx = target.x / 20
       and chunk.cy = target.y / 20`,
    [hidden.public_id],
  );

  const deleted = await createEma(
    appPool,
    directOwners[1].id,
    WORLD_SLUG,
    createInput(120, 120, { wishText: `段階F-deleted-${randomUUID()}` }),
  );
  await deleteEma(appPool, directOwners[1].id, deleted.public_id, 1);

  const otherWorld = await createEma(
    appPool,
    directOwners[2].id,
    OTHER_WORLD_SLUG,
    createInput(130, 130, { wishText: `段階F-other-${randomUUID()}` }),
  );

  await adminPool.query(
    `insert into app_private.admin_users (user_id, role, enabled)
     values
       ($1::uuid, 'moderator', true),
       ($2::uuid, 'moderator', false)`,
    [identities.aal1Admin.id, identities.disabledAdmin.id],
  );

  return {
    hiddenPublicId: hidden.public_id,
    deletedPublicId: deleted.public_id,
    otherWorldPublicId: otherWorld.public_id,
  };
}

async function createThroughBrowser(browser, baseUrl, input, label) {
  const response = await browser.postAt(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas`,
    input,
    { "idempotency-key": randomUUID() },
  );
  return expectJson(response, label, 201);
}

function cellAt(chunk, x, y) {
  return chunk.cells.find((cell) => {
    if (cell.kind === "public") return cell.ema.x === x && cell.ema.y === y;
    return cell.x === x && cell.y === y;
  });
}

async function readChunk(baseUrl, x, y, label) {
  return publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/chunks?cx=${Math.floor(x / 20)}&cy=${Math.floor(y / 20)}`,
    label,
  );
}

async function verifyPublicBrowsing({
  adminPool,
  baseUrl,
  target,
  forbiddenSecrets,
}) {
  const before = await authUserCount(adminPool);
  const browser = new BrowserSession(baseUrl);
  const routes = [
    [`/api/v1/worlds/${WORLD_SLUG}`, "public world"],
    [
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}`,
      "public ema detail",
    ],
    [
      `/api/v1/worlds/${WORLD_SLUG}/chunks?cx=${Math.floor(target.x / 20)}&cy=${Math.floor(target.y / 20)}`,
      "public chunk",
    ],
  ];
  for (const [pathname, label] of routes) {
    const response = await browser.request(pathname, {
      headers: { accept: "application/json" },
    });
    assertNoStoreNoCookie(response, label);
    assert(response.status === 200, `${label} returned ${response.status}`);
    await response.arrayBuffer();
  }
  const feed = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas?limit=50&category=${TARGET_CATEGORY}`,
    "public ema feed",
  );
  assert(
    feed.body.items.some((item) => item.publicId === target.publicId),
    "public feed omitted the active moderation target",
  );
  const random = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/random?category=${TARGET_CATEGORY}`,
    "public random ema",
  );
  assert(
    random.body.item?.publicId === target.publicId,
    "category-scoped random selection omitted the active moderation target",
  );
  const nearby = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${target.publicId}`,
    "public nearby ema",
  );
  assert(
    nearby.body.origin.x === target.x && nearby.body.origin.y === target.y,
    "nearby lookup returned the wrong active origin",
  );
  const page = await browser.request(`/w/${WORLD_SLUG}/e/${target.publicId}`);
  assertNoStoreNoCookie(page, "public ema HTML");
  const html = await page.text();
  assert(page.status === 200, `public ema HTML returned ${page.status}`);
  assert(
    html.includes("stage-f-xss"),
    "escaped HTML marker was not rendered as text",
  );
  assert(
    !html.includes('<script id="stage-f-xss">') &&
      !html.includes("<img src=x onerror="),
    "user text became executable HTML markup",
  );
  assertTextExcludesSecrets(html, forbiddenSecrets, "public HTML");
  const rsc = await browser.request(
    `/w/${WORLD_SLUG}/e/${target.publicId}?_rsc=stage-f`,
    { headers: { RSC: "1" } },
  );
  assertNoStoreNoCookie(rsc, "public ema RSC");
  const rscText = await rsc.text();
  assert(rsc.status === 200, `public ema RSC returned ${rsc.status}`);
  assertTextExcludesSecrets(rscText, forbiddenSecrets, "public RSC");
  assert(
    browser.cookies.size === 0,
    "public browsing created a cookie session",
  );
  const after = await authUserCount(adminPool);
  assert(after === before, "public browsing created an Auth user");
  passed(
    "公開閲覧/list/random/nearbyはAuth/Cookieを作らず、HTML文字列を実行可能markupにしない",
  );
}

async function verifyModeratedPublicAbsence({ baseUrl, target, stateLabel }) {
  const detail = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}`,
    `${stateLabel} public detail`,
    404,
  );
  assertError(detail, "NOT_FOUND", `${stateLabel} public detail`);

  const feed = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas?limit=50&category=${TARGET_CATEGORY}`,
    `${stateLabel} public feed`,
  );
  assert(
    !feed.body.items.some((item) => item.publicId === target.publicId),
    `${stateLabel} ema remained in the public feed`,
  );
  const random = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/random?category=${TARGET_CATEGORY}`,
    `${stateLabel} public random`,
  );
  assert(
    random.body.item === null,
    `${stateLabel} ema remained in category-scoped random selection`,
  );
  const nearby = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/nearby?near=${target.publicId}`,
    `${stateLabel} public nearby`,
    404,
  );
  assertError(nearby, "NOT_FOUND", `${stateLabel} public nearby`);

  for (const variant of ["og", "square"]) {
    const image = await publicJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/image?variant=${variant}`,
      `${stateLabel} public ${variant} image`,
      404,
      { "x-emanowa-test-client-ip": "198.51.100.51" },
    );
    assertError(image, "NOT_FOUND", `${stateLabel} public ${variant} image`);
  }

  const pageResponse = await fetch(
    `${baseUrl}/w/${WORLD_SLUG}/e/${target.publicId}`,
    { cache: "no-store", headers: { accept: "text/html" } },
  );
  assertNoStoreNoCookie(pageResponse, `${stateLabel} public HTML/metadata`);
  const html = await pageResponse.text();
  assert(
    pageResponse.status === 404,
    `${stateLabel} public HTML returned ${pageResponse.status}`,
  );
  assert(
    !html.includes("stage-f-xss") && !html.includes(TARGET_NICKNAME),
    `${stateLabel} public HTML/metadata exposed user content`,
  );

  const rscResponse = await fetch(
    `${baseUrl}/w/${WORLD_SLUG}/e/${target.publicId}?_rsc=stage-f-${stateLabel}`,
    { cache: "no-store", headers: { RSC: "1" } },
  );
  assertNoStoreNoCookie(rscResponse, `${stateLabel} public RSC`);
  const rsc = await rscResponse.text();
  assert(
    (rscResponse.status === 404 || rscResponse.status === 200) &&
      rscResponse.headers.get("content-type")?.includes("text/x-component") &&
      rsc.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
    `${stateLabel} public RSC returned ${rscResponse.status}`,
  );
  assert(
    !rsc.includes("stage-f-xss") && !rsc.includes(TARGET_NICKNAME),
    `${stateLabel} public RSC exposed user content`,
  );
}

async function verifyReports({ adminPool, baseA, baseB, target, fixtures }) {
  const pathName = `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/reports`;
  const before = await adminPool.query(
    "select count(*)::integer as count from app_private.reports",
  );

  const sameKeyReporter = new BrowserSession(baseA);
  await anonymous(sameKeyReporter);
  const sameKeyBody = { reason: "spam", detail: REPORT_DETAIL };
  const sameKey = randomUUID();
  const sameKeyResponses = await Promise.all(
    [baseA, baseB].map((baseUrl) =>
      sameKeyReporter.postAt(baseUrl, pathName, sameKeyBody, {
        "idempotency-key": sameKey,
      }),
    ),
  );
  const sameKeyResults = await Promise.all(
    sameKeyResponses.map((response, index) =>
      expectJson(response, `concurrent same-key report ${index + 1}`, 201),
    ),
  );
  for (const result of sameKeyResults) {
    assert(
      Object.keys(result.body).sort().join(",") === "accepted,reportId" &&
        result.body.accepted === true,
      "report receipt exposed more than acceptance",
    );
  }
  assert(
    JSON.stringify(sameKeyResults[0].body) ===
      JSON.stringify(sameKeyResults[1].body),
    "concurrent same-key reports returned different receipts",
  );
  const primaryReportId = sameKeyResults[0].body.reportId;

  for (const [index, baseUrl] of [baseA, baseB, baseA].entries()) {
    const existing = await expectJson(
      await sameKeyReporter.postAt(
        baseUrl,
        pathName,
        { reason: index % 2 === 0 ? "other" : "harassment" },
        { "idempotency-key": randomUUID() },
      ),
      `existing open report ${index + 1}`,
      200,
    );
    assert(
      existing.body.reportId === primaryReportId,
      "different key did not reuse the existing open report",
    );
  }
  const limited = await expectJson(
    await sameKeyReporter.postAt(
      baseB,
      pathName,
      { reason: "other" },
      { "idempotency-key": randomUUID() },
    ),
    "sixth cross-instance report",
    429,
  );
  assertError(limited, "RATE_LIMITED", "sixth cross-instance report");
  assertRetryAfter(limited, "sixth cross-instance report");

  const differentKeyReporter = new BrowserSession(baseA);
  await anonymous(differentKeyReporter);
  const differentKeyBody = {
    reason: "illegal_content",
    detail: "並行する別キー",
  };
  const differentKeyResponses = await Promise.all(
    [baseA, baseB].map((baseUrl) =>
      differentKeyReporter.postAt(baseUrl, pathName, differentKeyBody, {
        "idempotency-key": randomUUID(),
      }),
    ),
  );
  const differentKeyResults = await Promise.all(
    differentKeyResponses.map(async (response, index) => ({
      status: response.status,
      body: await responseJson(
        response,
        `concurrent different-key report ${index + 1}`,
      ),
    })),
  );
  assert(
    differentKeyResults
      .map((result) => result.status)
      .sort((left, right) => left - right)
      .join(",") === "200,201",
    `concurrent different-key reports returned ${differentKeyResults
      .map((result) => result.status)
      .join(",")}`,
  );
  assert(
    differentKeyResults.every(
      (result) =>
        result.body.accepted === true &&
        result.body.reportId === differentKeyResults[0].body.reportId,
    ),
    "concurrent different-key reports did not converge on one open report",
  );
  const secondaryReportId = differentKeyResults[0].body.reportId;
  assert(
    secondaryReportId !== primaryReportId,
    "different reporters unexpectedly shared an open report",
  );

  const stored = await adminPool.query(
    `select report.id, report.reason, report.detail, report.state,
            ema.status as ema_status
     from app_private.reports as report
     join app_private.emas as ema on ema.id = report.ema_id
     where ema.public_id = $1::uuid`,
    [target.publicId],
  );
  assert(
    stored.rowCount === 2,
    "concurrent report retries/open reuse did not save exactly one row per reporter",
  );
  const primaryStored = stored.rows.find((row) => row.id === primaryReportId);
  const secondaryStored = stored.rows.find(
    (row) => row.id === secondaryReportId,
  );
  assert(
    primaryStored?.reason === "spam" &&
      primaryStored.detail === REPORT_DETAIL &&
      primaryStored.state === "open" &&
      primaryStored.ema_status === "active" &&
      secondaryStored?.reason === "illegal_content" &&
      secondaryStored.detail === "並行する別キー" &&
      secondaryStored.state === "open" &&
      secondaryStored.ema_status === "active",
    "report changed content/state or automatically hid the ema",
  );
  const after = await adminPool.query(
    "select count(*)::integer as count from app_private.reports",
  );
  assert(
    after.rows[0].count === before.rows[0].count + 2,
    "denied report reached storage",
  );

  const invisibleReporter = new BrowserSession(baseA);
  await anonymous(invisibleReporter);
  const invisibleBefore = after.rows[0].count;
  for (const [publicId, label] of [
    [fixtures.hiddenPublicId, "hidden report"],
    [fixtures.deletedPublicId, "deleted report"],
    [fixtures.otherWorldPublicId, "cross-world report"],
  ]) {
    const result = await expectJson(
      await invisibleReporter.post(
        `/api/v1/worlds/${WORLD_SLUG}/emas/${publicId}/reports`,
        { reason: "other" },
        { "idempotency-key": randomUUID() },
      ),
      label,
      404,
    );
    assertError(result, "NOT_FOUND", label);
  }
  const invisibleAfter = await adminPool.query(
    "select count(*)::integer as count from app_private.reports",
  );
  assert(
    invisibleAfter.rows[0].count === invisibleBefore,
    "hidden/deleted/cross-world report leaked into storage",
  );
  passed(
    "通報same/different-key並行収束・5/hourの2instance共有・非公開404・自動hideなしを確認",
  );
  return primaryReportId;
}

async function verifyCreateRateLimit({ adminPool, baseA, baseB }) {
  const browser = new BrowserSession(baseA);
  await anonymous(browser);
  let publicId;
  for (let index = 0; index < 10; index += 1) {
    const baseUrl = index % 2 === 0 ? baseA : baseB;
    const response = await browser.postAt(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas`,
      createInput(300 + index, 300, {
        wishText: `create上限 ${index + 1}`,
      }),
      { "idempotency-key": randomUUID() },
    );
    const result = await expectJson(
      response,
      `create quota request ${index + 1}`,
      index === 0 ? 201 : 409,
    );
    if (index === 0) publicId = result.body.receipt.publicId;
    else
      assertError(
        result,
        "OWNER_LIMIT_REACHED",
        `create quota request ${index + 1}`,
      );
  }
  assert(publicId, "create quota did not persist its first ema");
  const denied = await expectJson(
    await browser.postAt(
      baseB,
      `/api/v1/worlds/${WORLD_SLUG}/emas`,
      createInput(310, 300, { wishText: "create上限超過" }),
      { "idempotency-key": randomUUID() },
    ),
    "create quota request 11",
    429,
  );
  assertError(denied, "RATE_LIMITED", "create quota request 11");
  assertRetryAfter(denied, "create quota request 11");

  const stored = await adminPool.query(
    `select count(*)::integer as count, min(version)::integer as version
     from app_private.emas
     where owner_id = (
       select owner_id from app_private.emas where public_id = $1::uuid
     )`,
    [publicId],
  );
  assert(
    stored.rows[0].count === 1 && stored.rows[0].version === 1,
    "create quota denial changed persisted data",
  );
  passed("create 10/minを2instanceで交互消費し11件目429・保存不変を確認");
}

async function verifyEditRateLimit({ adminPool, baseA, baseB }) {
  const browser = new BrowserSession(baseA);
  await anonymous(browser);
  const created = await createThroughBrowser(
    browser,
    baseA,
    createInput(400, 400, { wishText: "edit上限 初期" }),
    "edit quota fixture",
  );
  const publicId = created.body.receipt.publicId;

  for (let index = 0; index < 30; index += 1) {
    const baseUrl = index % 2 === 0 ? baseA : baseB;
    const response = await browser.jsonAt(
      baseUrl,
      "PATCH",
      `/api/v1/me/emas/${publicId}`,
      {
        expectedVersion: index + 1,
        wishText: `edit上限 ${index + 1}`,
      },
      { "idempotency-key": randomUUID() },
    );
    const result = await expectJson(
      response,
      `edit quota request ${index + 1}`,
      200,
    );
    assert(
      result.body.receipt.version === index + 2,
      `edit quota request ${index + 1} returned the wrong version`,
    );
  }

  const denied = await expectJson(
    await browser.jsonAt(
      baseB,
      "PATCH",
      `/api/v1/me/emas/${publicId}`,
      { expectedVersion: 31, wishText: "edit上限超過" },
      { "idempotency-key": randomUUID() },
    ),
    "edit quota request 31",
    429,
  );
  assertError(denied, "RATE_LIMITED", "edit quota request 31");
  assertRetryAfter(denied, "edit quota request 31");
  const stored = await adminPool.query(
    `select version, wish_text
     from app_private.emas where public_id = $1::uuid`,
    [publicId],
  );
  assert(
    stored.rows[0]?.version === 31 &&
      stored.rows[0].wish_text === "edit上限 30",
    "edit quota denial changed data or version",
  );
  passed(
    "edit 30/10minを2instanceで交互消費し31件目429・本文/version不変を確認",
  );
}

async function verifyImageRateLimit({ adminPool, baseA, baseB, target }) {
  const pathname = `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/image?variant=og`;
  const missingPathname = `/api/v1/worlds/${WORLD_SLUG}/emas/${randomUUID()}/image?variant=og`;
  const sourceA = "198.51.100.41";
  const sourceB = "198.51.100.42";
  const before = await adminPool.query(
    "select version from app_private.emas where public_id = $1::uuid",
    [target.publicId],
  );
  const remainingInWindow = 60_000 - (Date.now() % 60_000);
  if (remainingInWindow < 15_000) {
    await delay(remainingInWindow + 250);
  }
  const responses = await Promise.all(
    Array.from({ length: 31 }, (_, index) =>
      fetch(`${index % 2 === 0 ? baseA : baseB}${missingPathname}`, {
        cache: "no-store",
        headers: { "x-emanowa-test-client-ip": sourceA },
      }),
    ),
  );
  const results = await Promise.all(
    responses.map(async (response, index) => {
      const label = `concurrent image quota request ${index + 1}`;
      assertNoStoreNoCookie(response, label);
      return { response, body: await responseJson(response, label) };
    }),
  );
  const allowed = results.filter((result) => result.response.status === 404);
  const deniedResults = results.filter(
    (result) => result.response.status === 429,
  );
  assert(
    allowed.length === 30 && deniedResults.length === 1,
    `concurrent image limit returned ${allowed.length} allowed and ${deniedResults.length} denied requests`,
  );
  for (const result of allowed) {
    assertError(result, "NOT_FOUND", "allowed missing image");
  }
  const [denied] = deniedResults;
  assertError(denied, "RATE_LIMITED", "image quota request 31");
  assertRetryAfter(denied, "image quota request 31");

  const bucket = await adminPool.query(
    `select count(*)::integer as rows, max(count)::integer as consumed
     from app_private.rate_limit_buckets
     where action = 'image' and subject_hash = $1::bytea
       and expires_at > transaction_timestamp()`,
    [rateLimitSubjectHash("image", `source:${sourceA}`)],
  );
  assert(
    bucket.rows[0]?.rows === 1 && bucket.rows[0].consumed === 31,
    "concurrent image limiter did not atomically persist the exact capped count",
  );

  const independent = await fetch(`${baseA}${pathname}`, {
    cache: "no-store",
    headers: { "x-emanowa-test-client-ip": sourceB },
  });
  assert(
    independent.status === 200,
    `independent image source returned ${independent.status}`,
  );
  await independent.arrayBuffer();
  const after = await adminPool.query(
    "select version from app_private.emas where public_id = $1::uuid",
    [target.publicId],
  );
  assert(
    after.rows[0]?.version === before.rows[0]?.version,
    "image rate limiting changed ema version",
  );
  passed(
    "image 30/min/sourceを2instanceへ31件並行送信しexact 30/1・別source独立・保存不変を確認",
  );
}

async function verifyOtpRateLimit({
  adminPool,
  appPool,
  baseA,
  baseB,
  identities,
}) {
  const firstBrowser = new BrowserSession(baseA);
  const before = await adminPool.query(
    "select updated_at::text as updated_at from auth.users where id = $1::uuid",
    [identities.general.id],
  );
  const recoveryResponses = await Promise.all([
    firstBrowser.postAt(baseA, "/api/v1/auth/email/recover", {
      email: identities.general.email,
    }),
    firstBrowser.postAt(baseB, "/api/v1/auth/email/recover", {
      email: identities.general.email.toUpperCase(),
    }),
  ]);
  const recoveryResults = await Promise.all(
    recoveryResponses.map(async (response, index) => ({
      response,
      body: await responseJson(response, `concurrent recovery ${index + 1}`),
    })),
  );
  assert(
    recoveryResults
      .map((result) => result.response.status)
      .sort((left, right) => left - right)
      .join(",") === "202,429",
    `concurrent recovery returned ${recoveryResults
      .map((result) => result.response.status)
      .join(",")}`,
  );
  const first = recoveryResults.find(
    (result) => result.response.status === 202,
  );
  const concurrentDenied = recoveryResults.find(
    (result) => result.response.status === 429,
  );
  assert(
    first?.body.accepted === true,
    "first recovery request was not accepted",
  );
  assert(concurrentDenied, "concurrent recovery did not return one denial");
  assertError(concurrentDenied, "RATE_LIMITED", "concurrent recovery loser");
  assertRetryAfter(concurrentDenied, "concurrent recovery loser");
  const afterFirst = await adminPool.query(
    "select updated_at::text as updated_at from auth.users where id = $1::uuid",
    [identities.general.id],
  );
  const cooldown = await adminPool.query(
    `select count(*)::integer as rows,
            max(count)::integer as consumed,
            max(cardinality(reservation_ids))::integer as reservations,
            min(round(extract(epoch from (expires_at - window_start))))::integer as seconds
       from app_private.rate_limit_buckets
      where action = 'otp' and subject_hash = $1::bytea
        and expires_at > transaction_timestamp()`,
    [
      rateLimitSubjectHash(
        "otp",
        `email:${identities.general.email
          .trim()
          .normalize("NFC")
          .toLocaleLowerCase("en-US")}`,
      ),
    ],
  );
  assert(
    cooldown.rows[0]?.rows === 1 &&
      cooldown.rows[0].consumed === 1 &&
      cooldown.rows[0].reservations === 1 &&
      cooldown.rows[0].seconds === 60,
    "OTP limiter did not persist one exact 60-second recipient cooldown",
  );
  const denied = await expectJson(
    await firstBrowser.postAt(baseB, "/api/v1/auth/email/recover", {
      email: identities.general.email.toUpperCase(),
    }),
    "third normalized recovery request",
    429,
  );
  assertError(denied, "RATE_LIMITED", "third normalized recovery request");
  assertRetryAfter(denied, "third normalized recovery request");
  const afterDenied = await adminPool.query(
    "select updated_at::text as updated_at from auth.users where id = $1::uuid",
    [identities.general.id],
  );
  assert(
    afterDenied.rows[0]?.updated_at === afterFirst.rows[0]?.updated_at,
    "denied recovery request reached Auth storage",
  );
  assert(before.rowCount === 1, "recovery fixture user was missing");

  const verifyBrowser = new BrowserSession(baseA);
  const verificationEmail = `stage-f-no-account-${randomUUID()}@example.invalid`;
  for (let index = 0; index < 5; index += 1) {
    const invalid = await expectJson(
      await verifyBrowser.postAt(
        index % 2 === 0 ? baseA : baseB,
        "/api/v1/auth/email/verify",
        {
          flow: "recover",
          email: verificationEmail,
          token: "000000",
        },
      ),
      `OTP verification attempt ${index + 1}`,
      400,
    );
    assertError(
      invalid,
      "INVALID_OTP",
      `OTP verification attempt ${index + 1}`,
    );
  }
  const verifyDenied = await expectJson(
    await verifyBrowser.postAt(baseB, "/api/v1/auth/email/verify", {
      flow: "recover",
      email: verificationEmail,
      token: "000000",
    }),
    "OTP verification attempt 6",
    429,
  );
  assertError(verifyDenied, "RATE_LIMITED", "OTP verification attempt 6");
  assertRetryAfter(verifyDenied, "OTP verification attempt 6");
  const verificationBucket = await adminPool.query(
    `select count(*)::integer as rows, max(count)::integer as consumed
       from app_private.rate_limit_buckets
      where action = 'otp_verify' and subject_hash = $1::bytea
        and expires_at > transaction_timestamp()`,
    [
      rateLimitSubjectHash(
        "otp_verify",
        `recover:email:${verificationEmail
          .trim()
          .normalize("NFC")
          .toLocaleLowerCase("en-US")}:source:127.0.0.1`,
      ),
    ],
  );
  assert(
    verificationBucket.rows[0]?.rows === 1 &&
      verificationBucket.rows[0].consumed === 6,
    "OTP verification limiter did not persist the exact independent cap",
  );

  const verificationSourceSubject = "recover:source:127.0.0.1";
  const verificationSourceHash = rateLimitSubjectHash(
    "otp_verify_source",
    verificationSourceSubject,
  );
  const sourcePrefill = await adminPool.query(
    `update app_private.rate_limit_buckets
        set count = 29
      where action = 'otp_verify_source' and subject_hash = $1::bytea
        and count = 5 and expires_at > transaction_timestamp()
      returning count`,
    [verificationSourceHash],
  );
  assert(
    sourcePrefill.rowCount === 1 && sourcePrefill.rows[0]?.count === 29,
    "OTP source limiter fixture did not advance exactly to 29",
  );
  const sourceBoundaryEmail = `stage-f-source-boundary-${randomUUID()}@example.invalid`;
  const sourceBoundary = await expectJson(
    await verifyBrowser.postAt(baseA, "/api/v1/auth/email/verify", {
      flow: "recover",
      email: sourceBoundaryEmail,
      token: "000000",
    }),
    "OTP verification source attempt 30",
    400,
  );
  assertError(
    sourceBoundary,
    "INVALID_OTP",
    "OTP verification source attempt 30",
  );
  const sourceDenied = await expectJson(
    await verifyBrowser.postAt(baseB, "/api/v1/auth/email/verify", {
      flow: "recover",
      email: `stage-f-source-denied-${randomUUID()}@example.invalid`,
      token: "000000",
    }),
    "OTP verification source attempt 31",
    429,
  );
  assertError(
    sourceDenied,
    "RATE_LIMITED",
    "OTP verification source attempt 31",
  );
  assertRetryAfter(sourceDenied, "OTP verification source attempt 31");
  const verificationSourceBucket = await adminPool.query(
    `select count(*)::integer as rows, max(count)::integer as consumed
       from app_private.rate_limit_buckets
      where action = 'otp_verify_source' and subject_hash = $1::bytea
        and expires_at > transaction_timestamp()`,
    [verificationSourceHash],
  );
  assert(
    verificationSourceBucket.rows[0]?.rows === 1 &&
      verificationSourceBucket.rows[0].consumed === 31,
    "OTP verification source limiter did not persist the exact shared cap",
  );

  const verificationTargetHash = rateLimitSubjectHash(
    "otp_verify_target",
    `recover:email:${verificationEmail
      .trim()
      .normalize("NFC")
      .toLocaleLowerCase("en-US")}`,
  );
  const targetPrefill = await adminPool.query(
    `update app_private.rate_limit_buckets
        set count = 29
      where action = 'otp_verify_target' and subject_hash = $1::bytea
        and count = 5 and expires_at > transaction_timestamp()
      returning count`,
    [verificationTargetHash],
  );
  assert(
    targetPrefill.rowCount === 1 && targetPrefill.rows[0]?.count === 29,
    "OTP target limiter fixture did not advance exactly to 29",
  );
  const targetBoundary = await expectJson(
    await verifyBrowser.postAt(
      baseA,
      "/api/v1/auth/email/verify",
      { flow: "recover", email: verificationEmail, token: "000000" },
      { "x-emanowa-test-client-ip": "203.0.113.30" },
    ),
    "OTP verification target attempt 30",
    400,
  );
  assertError(
    targetBoundary,
    "INVALID_OTP",
    "OTP verification target attempt 30",
  );
  const targetDenied = await expectJson(
    await verifyBrowser.postAt(
      baseB,
      "/api/v1/auth/email/verify",
      { flow: "recover", email: verificationEmail, token: "000000" },
      { "x-emanowa-test-client-ip": "203.0.113.31" },
    ),
    "OTP verification target attempt 31",
    429,
  );
  assertError(
    targetDenied,
    "RATE_LIMITED",
    "OTP verification target attempt 31",
  );
  assertRetryAfter(targetDenied, "OTP verification target attempt 31");
  const verificationTargetBucket = await adminPool.query(
    `select count(*)::integer as rows, max(count)::integer as consumed
       from app_private.rate_limit_buckets
      where action = 'otp_verify_target' and subject_hash = $1::bytea
        and expires_at > transaction_timestamp()`,
    [verificationTargetHash],
  );
  assert(
    verificationTargetBucket.rows[0]?.rows === 1 &&
      verificationTargetBucket.rows[0].consumed === 31,
    "OTP verification target limiter did not persist the exact shared cap",
  );

  const concurrentSource = "198.51.100.250";
  const concurrentSourceHash = rateLimitSubjectHash(
    "otp_verify_source",
    `recover:source:${concurrentSource}`,
  );
  const concurrentBatch = randomUUID();
  const concurrentVerification = await Promise.all(
    Array.from({ length: 31 }, async (_, index) => {
      const email = `stage-f-concurrent-${concurrentBatch}-${index}@example.invalid`;
      const normalizedEmail = email
        .trim()
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      const result = await appPool.query(
        `select allowed, current_count
           from app_private.consume_recovery_otp_verification_rate_limit(
             $1::bytea, $2::bytea, $3::bytea
           )`,
        [
          rateLimitSubjectHash(
            "otp_verify",
            `recover:email:${normalizedEmail}:source:${concurrentSource}`,
          ),
          rateLimitSubjectHash(
            "otp_verify_target",
            `recover:email:${normalizedEmail}`,
          ),
          concurrentSourceHash,
        ],
      );
      return result.rows[0];
    }),
  );
  assert(
    concurrentVerification.filter((row) => row?.allowed === true).length ===
      30 &&
      concurrentVerification.filter((row) => row?.allowed === false).length ===
        1 &&
      concurrentVerification.some(
        (row) => row?.allowed === false && row.current_count === 31,
      ),
    "concurrent OTP source limiter did not return exact 30 allowed / 1 denied",
  );
  const concurrentSourceBucket = await adminPool.query(
    `select count(*)::integer as rows, max(count)::integer as consumed
       from app_private.rate_limit_buckets
      where action = 'otp_verify_source' and subject_hash = $1::bytea
        and expires_at > transaction_timestamp()`,
    [concurrentSourceHash],
  );
  assert(
    concurrentSourceBucket.rows[0]?.rows === 1 &&
      concurrentSourceBucket.rows[0].consumed === 31,
    "concurrent OTP source limiter did not persist one exact shared bucket",
  );

  const independent = await expectJson(
    await firstBrowser.postAt(baseB, "/api/v1/auth/email/recover", {
      email: identities.aal1Admin.email,
    }),
    "independent recovery email",
    202,
  );
  assert(
    independent.body.accepted === true,
    "independent OTP subject was blocked",
  );
  passed(
    "OTP送信60秒・確認5/10分+復帰元/宛先30/10分を共有し、三軸関数31件並行のexact 30/1・両方向の分散試行・正規化・拒否時Auth不変を確認",
  );
}

async function verifyMutationFailsClosed({ adminPool, baseUrl, target }) {
  const browser = new BrowserSession(baseUrl);
  await anonymous(browser);
  const beforeEma = await adminPool.query(
    "select count(*)::integer as count from app_private.emas",
  );
  const beforeBuckets = await adminPool.query(
    `select count(*)::integer as rows, coalesce(sum(count), 0)::integer as consumed
     from app_private.rate_limit_buckets where action = 'create'`,
  );
  await adminPool.query(
    `revoke execute on function app_private.consume_rate_limit(text, bytea, integer, integer)
     from emanowa_app`,
  );
  let restored = false;
  try {
    const readable = await publicJson(
      baseUrl,
      `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}`,
      "public GET while limiter permission is revoked",
    );
    assert(
      readable.body.ema.publicId === target.publicId,
      "public GET stopped working",
    );
    const denied = await expectJson(
      await browser.post(
        `/api/v1/worlds/${WORLD_SLUG}/emas`,
        createInput(500, 500, { wishText: "limiter権限剥奪" }),
        { "idempotency-key": randomUUID() },
      ),
      "mutation while limiter permission is revoked",
      503,
    );
    assertError(
      denied,
      "TEMPORARILY_UNAVAILABLE",
      "mutation while limiter permission is revoked",
    );
  } finally {
    await adminPool.query(
      `grant execute on function app_private.consume_rate_limit(text, bytea, integer, integer)
       to emanowa_app`,
    );
    restored = true;
  }
  assert(restored, "consume_rate_limit grant was not restored");
  const afterEma = await adminPool.query(
    "select count(*)::integer as count from app_private.emas",
  );
  const afterBuckets = await adminPool.query(
    `select count(*)::integer as rows, coalesce(sum(count), 0)::integer as consumed
     from app_private.rate_limit_buckets where action = 'create'`,
  );
  assert(
    afterEma.rows[0].count === beforeEma.rows[0].count &&
      afterBuckets.rows[0].rows === beforeBuckets.rows[0].rows &&
      afterBuckets.rows[0].consumed === beforeBuckets.rows[0].consumed,
    "failed-closed mutation changed data or rate buckets",
  );
  const recovered = await expectJson(
    await browser.post(
      `/api/v1/worlds/${WORLD_SLUG}/emas`,
      createInput(500, 500, { wishText: "limiter権限復旧" }),
      { "idempotency-key": randomUUID() },
    ),
    "mutation after limiter grant restore",
    201,
  );
  assert(
    recovered.body.receipt.publicId,
    "restored limiter did not allow mutation",
  );
  passed(
    "consume_rate_limit権限欠落時はGET継続・mutation 503・未保存、grant復旧を確認",
  );
}

function runAdminAccessCommand(action, userId, migrationDatabaseUrl) {
  const script = path.join(repositoryRoot, "scripts", "manage-admin.mjs");
  execFileSync(process.execPath, [script, action, userId], {
    cwd: repositoryRoot,
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationDatabaseUrl },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function adminGet(browser, pathname, label, expectedStatus) {
  return expectJson(await browser.request(pathname), label, expectedStatus);
}

async function adminPage(browser, label, forbiddenSecrets) {
  const response = await browser.request("/admin", {
    headers: { accept: "text/html" },
  });
  const html = await response.text();
  assert(response.status === 200, `${label} returned ${response.status}`);
  assertTextExcludesSecrets(html, forbiddenSecrets, label);
  assert(!html.includes("otpauth://"), `${label} serialized a TOTP secret URI`);
  return html;
}

async function verifyAdminAuthorization({
  apiUrl,
  publishableKey,
  baseUrl,
  identities,
  migrationDatabaseUrl,
  forbiddenSecrets,
}) {
  const unauthenticated = await adminGet(
    new BrowserSession(baseUrl),
    "/api/v1/admin/reports?state=open",
    "unauthenticated admin API",
    401,
  );
  assertError(unauthenticated, "AUTH_REQUIRED", "unauthenticated admin API");

  const anonymousBrowser = new BrowserSession(baseUrl);
  await anonymous(anonymousBrowser);
  const anonymousResult = await adminGet(
    anonymousBrowser,
    "/api/v1/admin/reports?state=open",
    "anonymous general admin API",
    403,
  );
  assertError(anonymousResult, "ADMIN_REQUIRED", "anonymous general admin API");

  const general = await signInRegistered(
    apiUrl,
    publishableKey,
    baseUrl,
    identities.general,
    "general user",
  );
  const generalResult = await adminGet(
    general.browser,
    "/api/v1/admin/reports?state=open",
    "registered general admin API",
    403,
  );
  assertError(generalResult, "ADMIN_REQUIRED", "registered general admin API");

  const aal1Admin = await signInRegistered(
    apiUrl,
    publishableKey,
    baseUrl,
    identities.aal1Admin,
    "aal1 admin",
  );
  const aal1Result = await adminGet(
    aal1Admin.browser,
    "/api/v1/admin/reports?state=open",
    "admin without MFA",
    403,
  );
  assertError(aal1Result, "ADMIN_REQUIRED", "admin without MFA");
  const aal1Page = await adminPage(
    aal1Admin.browser,
    "aal1 admin page",
    forbiddenSecrets,
  );
  assert(
    aal1Page.includes("認証アプリでMFAを完了する") &&
      !aal1Page.includes("通報キュー"),
    "aal1 admin page did not show only the MFA gate",
  );

  const fake = await signInRegistered(
    apiUrl,
    publishableKey,
    baseUrl,
    identities.fakeMetadata,
    "fake metadata user",
  );
  await promoteToAal2(fake.client, "fake-metadata");
  const fakeResult = await adminGet(
    fake.browser,
    "/api/v1/admin/reports?state=open",
    "aal2 fake metadata admin",
    403,
  );
  assertError(fakeResult, "ADMIN_REQUIRED", "aal2 fake metadata admin");
  const fakePage = await adminPage(
    fake.browser,
    "aal2 non-admin page",
    forbiddenSecrets,
  );
  assert(
    fakePage.includes("管理者権限がありません") &&
      !fakePage.includes("通報キュー"),
    "aal2 non-admin page bypassed the permission gate",
  );

  const disabled = await signInRegistered(
    apiUrl,
    publishableKey,
    baseUrl,
    identities.disabledAdmin,
    "disabled admin",
  );
  await promoteToAal2(disabled.client, "disabled-admin");
  const disabledResult = await adminGet(
    disabled.browser,
    "/api/v1/admin/reports?state=open",
    "disabled aal2 admin",
    403,
  );
  assertError(disabledResult, "ADMIN_REQUIRED", "disabled aal2 admin");

  const valid = await signInRegistered(
    apiUrl,
    publishableKey,
    baseUrl,
    identities.validAdmin,
    "valid admin",
  );
  await promoteToAal2(valid.client, "valid-admin");
  runAdminAccessCommand(
    "enable",
    identities.validAdmin.id,
    migrationDatabaseUrl,
  );
  const allowed = await adminGet(
    valid.browser,
    "/api/v1/admin/reports?state=open",
    "enabled aal2 admin",
    200,
  );
  assert(
    Array.isArray(allowed.body.items),
    "enabled aal2 admin list was invalid",
  );
  const allowedPage = await adminPage(
    valid.browser,
    "enabled aal2 admin page",
    forbiddenSecrets,
  );
  assert(
    allowedPage.includes("通報キュー") &&
      !allowedPage.includes("認証アプリでMFAを完了する"),
    "enabled aal2 admin page did not render the moderation queue",
  );

  runAdminAccessCommand(
    "disable",
    identities.validAdmin.id,
    migrationDatabaseUrl,
  );
  const revoked = await adminGet(
    valid.browser,
    "/api/v1/admin/reports?state=open",
    "immediately disabled aal2 admin",
    403,
  );
  assertError(revoked, "ADMIN_REQUIRED", "immediately disabled aal2 admin");
  const revokedPage = await adminPage(
    valid.browser,
    "immediately disabled admin page",
    forbiddenSecrets,
  );
  assert(
    revokedPage.includes("管理者権限がありません") &&
      !revokedPage.includes("通報キュー"),
    "disabled admin page retained the moderation queue",
  );
  runAdminAccessCommand(
    "enable",
    identities.validAdmin.id,
    migrationDatabaseUrl,
  );
  const restored = await adminGet(
    valid.browser,
    "/api/v1/admin/reports?state=open",
    "re-enabled aal2 admin",
    200,
  );
  assert(
    Array.isArray(restored.body.items),
    "re-enabled admin did not recover",
  );
  passed(
    "管理APIの未認証/一般/AAL1/metadata偽装/無効admin拒否と実AAL2・即時無効化を確認",
  );
  return valid.browser;
}

async function verifyAdminModeration({
  adminPool,
  baseA,
  baseB,
  adminBrowser,
  ownerBrowser,
  target,
  reportId,
}) {
  const baseUrl = baseA;
  const openList = await adminGet(
    adminBrowser,
    "/api/v1/admin/reports?state=open&limit=50",
    "open admin report list",
    200,
  );
  assert(
    openList.response.headers
      .get("content-type")
      ?.includes("application/json") &&
      openList.response.headers.get("x-content-type-options") === "nosniff",
    "admin report list is not protected JSON",
  );
  const openItem = openList.body.items.find(
    (item) => item.reportId === reportId,
  );
  assert(openItem, "admin report list omitted the open report");
  assert(
    openItem.detail === REPORT_DETAIL &&
      openItem.ema.publicId === target.publicId &&
      openItem.ema.messageText === XSS_WISH,
    "admin report list returned the wrong safe projection",
  );

  const moderationPath = `/api/v1/admin/emas/${target.publicId}/moderation`;
  const hideBody = {
    action: "hide",
    reasonCode: "spam",
    expectedVersion: 1,
  };
  const hideAttempts = [
    { baseUrl: baseA, key: randomUUID() },
    { baseUrl: baseB, key: randomUUID() },
  ];
  const hideResponses = await Promise.all(
    hideAttempts.map(({ baseUrl: attemptBaseUrl, key }) =>
      adminBrowser.postAt(attemptBaseUrl, moderationPath, hideBody, {
        "idempotency-key": key,
      }),
    ),
  );
  const hideResults = await Promise.all(
    hideResponses.map(async (response, index) => ({
      ...hideAttempts[index],
      response,
      body: await responseJson(response, `concurrent admin hide ${index + 1}`),
    })),
  );
  assert(
    hideResults
      .map((result) => result.response.status)
      .sort((left, right) => left - right)
      .join(",") === "200,409",
    `concurrent admin hide returned ${hideResults
      .map((result) => result.response.status)
      .join(",")}`,
  );
  const hidden = hideResults.find((result) => result.response.status === 200);
  const hideVersionConflict = hideResults.find(
    (result) => result.response.status === 409,
  );
  assertError(
    hideVersionConflict,
    "VERSION_CONFLICT",
    "concurrent admin hide loser",
  );
  assert(
    hidden.body.receipt.result === "updated" &&
      hidden.body.receipt.version === 2 &&
      hidden.body.receipt.canonicalUrl ===
        `/w/${WORLD_SLUG}/e/${target.publicId}`,
    "admin hide returned the wrong receipt",
  );
  const replayBaseUrl = hidden.baseUrl === baseA ? baseB : baseA;
  const hideReplay = await expectJson(
    await adminBrowser.postAt(replayBaseUrl, moderationPath, hideBody, {
      "idempotency-key": hidden.key,
    }),
    "admin hide replay on other instance",
    200,
  );
  assert(
    JSON.stringify(hideReplay.body) === JSON.stringify(hidden.body),
    "admin hide replay changed its receipt",
  );
  const hideKeyConflict = await expectJson(
    await adminBrowser.post(
      moderationPath,
      { action: "restore", reasonCode: "spam", expectedVersion: 1 },
      { "idempotency-key": hidden.key },
    ),
    "admin moderation idempotency conflict",
    409,
  );
  assertError(
    hideKeyConflict,
    "IDEMPOTENCY_KEY_REUSED",
    "admin moderation idempotency conflict",
  );
  const staleRestore = await expectJson(
    await adminBrowser.post(
      moderationPath,
      { action: "restore", reasonCode: "spam", expectedVersion: 1 },
      { "idempotency-key": randomUUID() },
    ),
    "admin moderation version conflict",
    409,
  );
  assertError(
    staleRestore,
    "VERSION_CONFLICT",
    "admin moderation version conflict",
  );

  const hideAudit = await adminPool.query(
    `select count(*)::integer as count
     from app_private.moderation_audit as audit
     join app_private.emas as ema on ema.id = audit.ema_id
     where ema.public_id = $1::uuid and audit.action = 'hide'`,
    [target.publicId],
  );
  assert(
    hideAudit.rows[0]?.count === 1,
    "concurrent moderation race or replay produced duplicate hide audits",
  );

  await verifyModeratedPublicAbsence({
    baseUrl,
    target,
    stateLabel: "hidden",
  });
  const hiddenChunk = await readChunk(
    baseUrl,
    target.x,
    target.y,
    "hidden chunk",
  );
  const occupied = cellAt(hiddenChunk.body, target.x, target.y);
  assert(
    occupied?.kind === "occupied" &&
      !("ema" in occupied) &&
      !JSON.stringify(occupied).includes(target.publicId) &&
      !JSON.stringify(occupied).includes(XSS_WISH),
    "hidden chunk exposed discoverable content",
  );
  const hiddenOwner = await expectJson(
    await ownerBrowser.request(`/api/v1/me/emas?world=${WORLD_SLUG}`),
    "hidden owner view",
    200,
  );
  assert(
    hiddenOwner.body.ema?.status === "hidden" &&
      hiddenOwner.body.ema?.version === 2 &&
      hiddenOwner.body.ema?.wishText === XSS_WISH,
    "owner lost its hidden ema or content",
  );

  const restored = await expectJson(
    await adminBrowser.post(
      moderationPath,
      { action: "restore", reasonCode: "other", expectedVersion: 2 },
      { "idempotency-key": randomUUID() },
    ),
    "admin restore",
    200,
  );
  assert(
    restored.body.receipt.result === "updated" &&
      restored.body.receipt.version === 3 &&
      restored.body.receipt.canonicalUrl ===
        `/w/${WORLD_SLUG}/e/${target.publicId}`,
    "admin restore returned the wrong receipt",
  );
  const restoredPublic = await publicJson(
    baseUrl,
    `/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}`,
    "restored public detail",
  );
  assert(
    restoredPublic.body.ema.messageText === XSS_WISH,
    "restored public detail did not reflect the ema",
  );
  const restoredImage = await fetch(
    `${baseUrl}/api/v1/worlds/${WORLD_SLUG}/emas/${target.publicId}/image?variant=og`,
    {
      cache: "no-store",
      headers: { "x-emanowa-test-client-ip": "198.51.100.51" },
    },
  );
  assert(
    restoredImage.status === 200 &&
      restoredImage.headers.get("content-type")?.startsWith("image/png"),
    `restored image returned ${restoredImage.status}`,
  );
  await restoredImage.arrayBuffer();
  const restoredChunk = await readChunk(
    baseUrl,
    target.x,
    target.y,
    "restored chunk",
  );
  const publicCell = cellAt(restoredChunk.body, target.x, target.y);
  assert(
    publicCell?.kind === "public" &&
      publicCell.ema.publicId === target.publicId,
    "restored chunk did not expose the public projection",
  );

  const reportPath = `/api/v1/admin/reports/${reportId}`;
  const resolveBody = { state: "resolved", expectedVersion: 1 };
  const resolveKey = randomUUID();
  const resolved = await expectJson(
    await adminBrowser.patch(reportPath, resolveBody, {
      "idempotency-key": resolveKey,
    }),
    "admin report resolve",
    200,
  );
  assert(
    resolved.body.reportId === reportId &&
      resolved.body.state === "resolved" &&
      resolved.body.version === 2,
    "report resolve returned the wrong receipt",
  );
  const resolveReplay = await expectJson(
    await adminBrowser.patch(reportPath, resolveBody, {
      "idempotency-key": resolveKey,
    }),
    "admin report resolve replay",
    200,
  );
  assert(
    JSON.stringify(resolveReplay.body) === JSON.stringify(resolved.body),
    "report resolve replay changed its receipt",
  );
  const resolveKeyConflict = await expectJson(
    await adminBrowser.patch(
      reportPath,
      { state: "dismissed", expectedVersion: 1 },
      { "idempotency-key": resolveKey },
    ),
    "report resolve idempotency conflict",
    409,
  );
  assertError(
    resolveKeyConflict,
    "IDEMPOTENCY_KEY_REUSED",
    "report resolve idempotency conflict",
  );
  const staleResolve = await expectJson(
    await adminBrowser.patch(
      reportPath,
      { state: "dismissed", expectedVersion: 1 },
      { "idempotency-key": randomUUID() },
    ),
    "report resolve version conflict",
    409,
  );
  assertError(
    staleResolve,
    "VERSION_CONFLICT",
    "report resolve version conflict",
  );

  const deleted = await expectJson(
    await adminBrowser.post(
      moderationPath,
      {
        action: "delete",
        reasonCode: "personal_information",
        expectedVersion: 3,
      },
      { "idempotency-key": randomUUID() },
    ),
    "admin delete",
    200,
  );
  assert(
    deleted.body.receipt.result === "deleted" &&
      deleted.body.receipt.version === 4 &&
      deleted.body.receipt.canonicalUrl ===
        `/w/${WORLD_SLUG}/e/${target.publicId}`,
    "admin delete returned the wrong receipt",
  );
  await verifyModeratedPublicAbsence({
    baseUrl,
    target,
    stateLabel: "deleted",
  });
  const deletedChunk = await readChunk(
    baseUrl,
    target.x,
    target.y,
    "deleted chunk",
  );
  assert(
    !cellAt(deletedChunk.body, target.x, target.y),
    "deleted chunk retained occupancy",
  );
  const deletedOwner = await expectJson(
    await ownerBrowser.request(`/api/v1/me/emas?world=${WORLD_SLUG}`),
    "deleted owner view",
    200,
  );
  assert(deletedOwner.body.ema === null, "deleted ema remained in owner view");

  const resolvedList = await adminGet(
    adminBrowser,
    "/api/v1/admin/reports?state=resolved&limit=50",
    "resolved admin report list",
    200,
  );
  const resolvedItem = resolvedList.body.items.find(
    (item) => item.reportId === reportId,
  );
  assert(
    resolvedItem?.state === "resolved" &&
      resolvedItem.version === 2 &&
      resolvedItem.ema.status === "deleted" &&
      resolvedItem.ema.messageText === null,
    "resolved admin list did not reflect delete safely",
  );

  const audit = await adminPool.query(
    `select audit.action, audit.reason_code, audit.before_status,
            audit.after_status, to_jsonb(audit)::text as serialized
     from app_private.moderation_audit as audit
     join app_private.emas as ema on ema.id = audit.ema_id
     where ema.public_id = $1::uuid
     order by audit.id`,
    [target.publicId],
  );
  assert(
    audit.rowCount === 3 &&
      audit.rows.map((row) => row.action).join(",") === "hide,restore,delete",
    "moderation audit was missing or replay produced duplicates",
  );
  for (const row of audit.rows) {
    assert(
      !row.serialized.includes(XSS_WISH) &&
        !row.serialized.includes(REPORT_DETAIL),
      "moderation audit stored user content",
    );
  }
  const auditColumns = await adminPool.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'app_private' and table_name = 'moderation_audit'`,
  );
  assert(
    auditColumns.rows.every(
      ({ column_name: name }) =>
        !["wish_text", "message_text", "detail", "nickname"].includes(name),
    ),
    "moderation audit schema contains user-content columns",
  );
  passed(
    "AAL2管理者の並行hide競合・一覧/restore/delete/resolve・全公開探索/画像/chunk/owner/audit反映を確認",
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
    output = `${output}${chunk.toString()}`.slice(-60_000);
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

function redactLogs(value, secrets) {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(secret, "[redacted]");
  }
  return result;
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

  const migrationUrl = new URL(rawDatabaseUrl);
  migrationUrl.username = "supabase_admin";
  const migrationDatabaseUrl = migrationUrl.toString();
  const adminPool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 6,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(32).toString("base64url");
  const adminAppPassword = randomBytes(32).toString("base64url");
  assert(
    appPassword !== adminAppPassword,
    "application role passwords must differ",
  );
  let appPool;
  let adminAppPool;
  let serverA;
  let serverB;

  try {
    const fixtureRole = await adminPool.query(
      "select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    assert(
      fixtureRole.rows[0]?.current_user === "supabase_admin" &&
        fixtureRole.rows[0].rolsuper &&
        fixtureRole.rows[0].rolbypassrls,
      "stage-f fixture setup requires the local migration administrator",
    );
    const roles = await adminPool.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles
       where rolname in ('emanowa_app', 'emanowa_admin_app')
       order by rolname`,
    );
    assert(roles.rowCount === 2, "Stage F application roles are missing");
    for (const role of roles.rows) {
      assert(!role.rolsuper, `${role.rolname} must not be superuser`);
      assert(!role.rolbypassrls, `${role.rolname} must not bypass RLS`);
      assert(!role.rolcreaterole, `${role.rolname} must not create roles`);
      assert(!role.rolcreatedb, `${role.rolname} must not create databases`);
    }
    await adminPool.query(
      `alter role emanowa_app login password ${sqlPasswordLiteral(appPassword)}`,
    );
    await adminPool.query(
      `alter role emanowa_admin_app login password ${sqlPasswordLiteral(adminAppPassword)}`,
    );
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
    const forbiddenBrowserSecrets = [
      appPassword,
      adminAppPassword,
      databaseUrl,
      adminDatabaseUrl,
      migrationDatabaseUrl,
      serviceRoleKey,
      RATE_LIMIT_SECRET,
    ];
    assert(
      new URL(databaseUrl).username !== new URL(adminDatabaseUrl).username &&
        new URL(databaseUrl).password !== new URL(adminDatabaseUrl).password,
      "normal and admin database connections were not separated",
    );
    appPool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      allowExitOnIdle: true,
    });
    adminAppPool = new Pool({
      connectionString: adminDatabaseUrl,
      max: 2,
      allowExitOnIdle: true,
    });
    const [normalIdentity, adminIdentity] = await Promise.all([
      appPool.query(
        "select current_user, current_setting('is_superuser') as superuser",
      ),
      adminAppPool.query(
        "select current_user, current_setting('is_superuser') as superuser",
      ),
    ]);
    assert(
      normalIdentity.rows[0]?.current_user === "emanowa_app" &&
        normalIdentity.rows[0].superuser === "off",
      "DATABASE_URL did not use the limited normal role",
    );
    assert(
      adminIdentity.rows[0]?.current_user === "emanowa_admin_app" &&
        adminIdentity.rows[0].superuser === "off",
      "ADMIN_DATABASE_URL did not use the limited admin role",
    );

    const serviceClient = createServiceClient(apiUrl, serviceRoleKey);
    const identities = {
      general: await createRegisteredIdentity(serviceClient, "general"),
      aal1Admin: await createRegisteredIdentity(serviceClient, "aal1-admin"),
      validAdmin: await createRegisteredIdentity(serviceClient, "valid-admin"),
      disabledAdmin: await createRegisteredIdentity(
        serviceClient,
        "disabled-admin",
      ),
      fakeMetadata: await createRegisteredIdentity(
        serviceClient,
        "fake-metadata",
        { role: "moderator", is_admin: true },
      ),
    };
    const fixtures = await installFixtures({
      adminPool,
      appPool,
      serviceClient,
      identities,
    });
    passed("限定された通常/管理DBロールと段階Ffixtureを準備");

    const portA = 34_000 + Math.floor(Math.random() * 400);
    const portB = 35_000 + Math.floor(Math.random() * 400);
    const baseA = `http://127.0.0.1:${portA}`;
    const baseB = `http://127.0.0.1:${portB}`;
    const nextBinary = path.join(
      repositoryRoot,
      "node_modules",
      ".bin",
      "next",
    );
    const commonEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ADMIN_DATABASE_URL: adminDatabaseUrl,
      EMANOWA_DATA_MODE: "database",
      EMANOWA_ENVIRONMENT: "test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      RATE_LIMIT_HMAC_SECRET: RATE_LIMIT_SECRET,
      NODE_ENV: "production",
    };
    // The production BFF receives only its two limited application URLs.
    // Provisioning and service-role credentials stay in this test process.
    delete commonEnvironment.MIGRATION_DATABASE_URL;
    delete commonEnvironment.SUPABASE_LOCAL_DB_URL;
    delete commonEnvironment.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
    delete commonEnvironment.SUPABASE_SERVICE_ROLE_KEY;
    execFileSync(nextBinary, ["build"], {
      cwd: repositoryRoot,
      env: { ...commonEnvironment, APP_ORIGIN: baseA },
      stdio: "inherit",
    });
    await assertStaticAssetsExcludeSecrets(forbiddenBrowserSecrets);
    passed(
      ".next/staticへ通常/管理/migration DB・service role・rate-limit秘密が混入しない",
    );

    serverA = startServer(nextBinary, portA, {
      ...commonEnvironment,
      APP_ORIGIN: baseA,
    });
    serverB = startServer(nextBinary, portB, {
      ...commonEnvironment,
      APP_ORIGIN: baseB,
    });
    await Promise.all([
      waitForServer(serverA, baseA),
      waitForServer(serverB, baseB),
    ]);

    try {
      const ownerBrowser = new BrowserSession(baseA);
      await anonymous(ownerBrowser);
      const targetCreate = await createThroughBrowser(
        ownerBrowser,
        baseA,
        createInput(200, 200, {
          wishText: XSS_WISH,
          nickname: TARGET_NICKNAME,
          category: TARGET_CATEGORY,
        }),
        "moderation target create",
      );
      const target = {
        publicId: targetCreate.body.receipt.publicId,
        x: 200,
        y: 200,
      };

      await verifyPublicBrowsing({
        adminPool,
        baseUrl: baseA,
        target,
        forbiddenSecrets: forbiddenBrowserSecrets,
      });
      const reportId = await verifyReports({
        adminPool,
        baseA,
        baseB,
        target,
        fixtures,
      });
      await verifyCreateRateLimit({ adminPool, baseA, baseB });
      await verifyEditRateLimit({ adminPool, baseA, baseB });
      await verifyImageRateLimit({ adminPool, baseA, baseB, target });
      await verifyOtpRateLimit({
        adminPool,
        appPool,
        baseA,
        baseB,
        identities,
      });
      await verifyMutationFailsClosed({
        adminPool,
        baseUrl: baseA,
        target,
      });
      const adminBrowser = await verifyAdminAuthorization({
        apiUrl,
        publishableKey,
        baseUrl: baseA,
        identities,
        migrationDatabaseUrl,
        forbiddenSecrets: forbiddenBrowserSecrets,
      });
      await verifyAdminModeration({
        adminPool,
        baseA,
        baseB,
        adminBrowser,
        ownerBrowser,
        target,
        reportId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const logs = redactLogs(
        `instance A:\n${serverA.logs()}\ninstance B:\n${serverB.logs()}`,
        [
          appPassword,
          adminAppPassword,
          databaseUrl,
          adminDatabaseUrl,
          migrationDatabaseUrl,
          serviceRoleKey,
          RATE_LIMIT_SECRET,
        ],
      );
      throw new Error(`${message}\nNext.js logs:\n${logs}`);
    }
  } finally {
    await Promise.all([stopChild(serverA), stopChild(serverB)]);
    if (appPool) await appPool.end();
    if (adminAppPool) await adminAppPool.end();
    await adminPool
      .query(
        `grant execute on function app_private.consume_rate_limit(text, bytea, integer, integer)
         to emanowa_app`,
      )
      .catch(() => undefined);
    await adminPool
      .query("alter role emanowa_app nologin password null")
      .catch(() => undefined);
    await adminPool
      .query("alter role emanowa_admin_app nologin password null")
      .catch(() => undefined);
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
