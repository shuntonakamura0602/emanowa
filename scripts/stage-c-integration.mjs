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

function createInput(x, y, overrides = {}) {
  return {
    x,
    y,
    wishText: `段階Cの願い ${x}-${y}`,
    nickname: "段階C",
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
    ...overrides,
  };
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

async function createEma(pool, actorId, input, idempotencyKey = randomUUID()) {
  const result = await withContext(pool, actorId, (client) =>
    client.query(
      `select * from app_private.create_ema(
        $1::text, $2::integer, $3::integer, $4::text, $5::text,
        $6::text, $7::text, $8::text, $9::text, $10::uuid, $11::bytea
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
        createRequestHash("2027", input),
      ],
    ),
  );
  assert(result.rowCount === 1, "create_ema did not return a receipt");
  return { ...result.rows[0], idempotencyKey };
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
  pool,
  actorId,
  publicId,
  input,
  idempotencyKey = randomUUID(),
) {
  const result = await withContext(pool, actorId, (client) =>
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
  pool,
  actorId,
  publicId,
  expectedVersion,
  idempotencyKey = randomUUID(),
) {
  const body = { expectedVersion };
  const result = await withContext(pool, actorId, (client) =>
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

function postgresCode(error) {
  return error && typeof error === "object" ? error.code : undefined;
}

async function expectPostgresCode(operation, expected) {
  try {
    await operation();
  } catch (error) {
    assert(
      postgresCode(error) === expected,
      `expected PostgreSQL ${expected}, got ${postgresCode(error) ?? "unknown"}`,
    );
    return;
  }
  throw new Error(`expected PostgreSQL ${expected}, but operation succeeded`);
}

async function createUsers(apiUrl, serviceRoleKey, count) {
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const users = [];
  for (let index = 0; index < count; index += 1) {
    const { data, error } = await client.auth.admin.createUser({
      email: `stage-c-${randomUUID()}@example.invalid`,
      email_confirm: true,
      password: randomBytes(18).toString("base64url"),
    });
    if (error) throw error;
    assert(data.user?.id, "admin user creation returned no UID");
    users.push(data.user.id);
  }
  return users;
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

async function responseJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text}`);
  }
}

async function anonymous(browser) {
  const response = await browser.post("/api/v1/auth/anonymous", {});
  const body = await responseJson(response, "anonymous auth");
  assert(
    response.status === 200,
    `anonymous auth failed: ${JSON.stringify(body)}`,
  );
  assert(body.authenticated === true, "anonymous auth was not authenticated");
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Next.js exited before readiness.\n${logs()}`);
    try {
      const response = await fetch(`${baseUrl}/api/v1/worlds/2027`, {
        cache: "no-store",
      });
      if (response.status === 200) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready.\n${logs()}`);
}

async function mailpitMessages() {
  const response = await fetch("http://127.0.0.1:54324/api/v1/messages", {
    cache: "no-store",
  });
  assert(response.ok, `Mailpit messages returned ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.messages) ? body.messages : [];
}

function messageRecipients(message) {
  return JSON.stringify(message.To ?? message.to ?? message.Recipients ?? []);
}

async function waitForOtp(email, excludedIds = new Set()) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const messages = await mailpitMessages();
    const message = messages.find((candidate) => {
      const id = candidate.ID ?? candidate.Id ?? candidate.id;
      return (
        !excludedIds.has(id) && messageRecipients(candidate).includes(email)
      );
    });
    if (message) {
      const id = message.ID ?? message.Id ?? message.id;
      const detailResponse = await fetch(
        `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      assert(
        detailResponse.ok,
        `Mailpit detail returned ${detailResponse.status}`,
      );
      const detail = await detailResponse.json();
      const token = JSON.stringify(detail).match(/\b\d{6}\b/u)?.[0];
      if (token) return { id, token };
    }
    await delay(250);
  }
  throw new Error(`OTP for ${email} was not found in local Mailpit`);
}

async function verifyHttpAndEmail({
  adminPool,
  apiUrl,
  publishableKey,
  databaseUrl,
}) {
  const port = 32_000 + Math.floor(Math.random() * 700);
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
        RATE_LIMIT_HMAC_SECRET: "stage-c-local-integration-only",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const collect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-30_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    await waitForServer(child, baseUrl, () => output);
    const owner = new BrowserSession(baseUrl);
    const stranger = new BrowserSession(baseUrl);
    await Promise.all([anonymous(owner), anonymous(stranger)]);

    const secretWish = `HTTP本人限定-${randomUUID()}`;
    const createResponse = await owner.post(
      "/api/v1/worlds/2027/emas",
      createInput(910, 910, { wishText: secretWish }),
      { "idempotency-key": randomUUID() },
    );
    const created = await responseJson(createResponse, "HTTP create");
    assert(createResponse.status === 201, JSON.stringify(created));
    const publicId = created.receipt.publicId;

    const beforeOwner = await owner.request("/api/v1/me/emas?world=2027");
    const beforeOwnerBody = await responseJson(beforeOwner, "owner GET");
    assert(
      beforeOwnerBody.ema?.wishText === secretWish,
      "owner GET lost wish text",
    );
    assert(
      beforeOwner.headers.get("x-emanowa-auth-kind") === "anonymous",
      "owner GET did not identify the verified anonymous session",
    );

    const strangerPatch = await stranger.request(
      `/api/v1/me/emas/${publicId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ expectedVersion: 1, nickname: "第三者" }),
      },
    );
    assert(strangerPatch.status === 404, "third-party PATCH must be 404");
    const strangerDelete = await stranger.request(
      `/api/v1/me/emas/${publicId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      },
    );
    assert(strangerDelete.status === 404, "third-party DELETE must be 404");

    const updateKey = randomUUID();
    const updateBody = {
      expectedVersion: 1,
      visibility: "unlisted",
      messageVisibility: "owner_only",
    };
    const updateResponse = await owner.request(`/api/v1/me/emas/${publicId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": updateKey,
      },
      body: JSON.stringify(updateBody),
    });
    const updated = await responseJson(updateResponse, "HTTP update");
    assert(updateResponse.status === 200, JSON.stringify(updated));
    const updateReplayResponse = await owner.request(
      `/api/v1/me/emas/${publicId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": updateKey,
        },
        body: JSON.stringify(updateBody),
      },
    );
    const updateReplay = await responseJson(
      updateReplayResponse,
      "HTTP update replay",
    );
    assert(updateReplayResponse.status === 200, JSON.stringify(updateReplay));
    assert(
      updateReplay.receipt.version === updated.receipt.version &&
        updateReplay.receipt.publicId === updated.receipt.publicId,
      "HTTP PATCH replay changed the immutable receipt",
    );
    const updateKeyReuse = await owner.request(`/api/v1/me/emas/${publicId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": updateKey,
      },
      body: JSON.stringify({ expectedVersion: 1, nickname: "別内容" }),
    });
    assert(
      updateKeyReuse.status === 409,
      "HTTP PATCH reused key with another body must be 409",
    );

    const publicResponse = await fetch(
      `${baseUrl}/api/v1/worlds/2027/emas/${publicId}`,
      { cache: "no-store" },
    );
    const publicText = await publicResponse.text();
    assert(publicResponse.status === 200, "unlisted direct detail must exist");
    assert(!publicText.includes(secretWish), "owner-only text leaked publicly");
    assert(
      JSON.parse(publicText).ema.messageText === null,
      "public DTO must use null",
    );
    const publicHtmlResponse = await fetch(`${baseUrl}/w/2027/e/${publicId}`, {
      cache: "no-store",
    });
    const publicHtml = await publicHtmlResponse.text();
    assert(publicHtmlResponse.status === 200, "public HTML detail must exist");
    assert(
      !publicHtml.includes(secretWish),
      "owner-only text leaked into HTML",
    );
    const publicRscResponse = await fetch(
      `${baseUrl}/w/2027/e/${publicId}?_rsc=stage-c`,
      { cache: "no-store", headers: { RSC: "1" } },
    );
    const publicRsc = await publicRscResponse.text();
    assert(publicRscResponse.status === 200, "public RSC detail must exist");
    assert(!publicRsc.includes(secretWish), "owner-only text leaked into RSC");

    const afterReload = await owner.request("/api/v1/me/emas?world=2027");
    const afterReloadBody = await responseJson(afterReload, "owner reload");
    assert(
      afterReloadBody.ema?.wishText === secretWish,
      "reload lost owner text",
    );
    passed(
      "独立Cookieで第三者更新/削除を拒否し、本人GETとowner-only公開境界を維持",
    );

    const email = `stage-c-link-${randomUUID()}@example.test`;
    const beforeMessages = new Set(
      (await mailpitMessages()).map(
        (message) => message.ID ?? message.Id ?? message.id,
      ),
    );
    const linkResponse = await owner.post("/api/v1/auth/email/link", { email });
    assert(
      linkResponse.status === 202,
      `email link returned ${linkResponse.status}`,
    );
    const linkOtp = await waitForOtp(email, beforeMessages);
    const verifyLink = await owner.post("/api/v1/auth/email/verify", {
      flow: "link",
      email,
      token: linkOtp.token,
    });
    assert(
      verifyLink.status === 200,
      `link verify returned ${verifyLink.status}`,
    );

    const identity = await adminPool.query(
      `select auth_user.id as auth_id, auth_user.is_anonymous, ema.owner_id
       from auth.users as auth_user
       join app_private.emas as ema on ema.owner_id = auth_user.id
       where auth_user.email = $1 and ema.public_id = $2::uuid`,
      [email, publicId],
    );
    assert(identity.rowCount === 1, "linked email no longer owns the ema");
    assert(
      identity.rows[0].auth_id === identity.rows[0].owner_id,
      "UID changed during link",
    );
    assert(
      identity.rows[0].is_anonymous === false,
      "linked user stayed anonymous",
    );
    const linkedOwner = await owner.request("/api/v1/me/emas?world=2027");
    assert(
      linkedOwner.headers.get("x-emanowa-auth-kind") === "registered",
      "owner GET did not identify the linked registered session",
    );

    const recovered = new BrowserSession(baseUrl);
    const recoverResponse = await recovered.post("/api/v1/auth/email/recover", {
      email,
    });
    assert(recoverResponse.status === 202, "recover request must return 202");
    const recoverOtp = await waitForOtp(email, new Set([linkOtp.id]));
    const verifyRecover = await recovered.post("/api/v1/auth/email/verify", {
      flow: "recover",
      email,
      token: recoverOtp.token,
    });
    assert(verifyRecover.status === 200, "recover OTP did not authenticate");
    const recoveredOwner = await recovered.request(
      "/api/v1/me/emas?world=2027",
    );
    const recoveredBody = await responseJson(
      recoveredOwner,
      "recovered owner GET",
    );
    assert(
      recoveredBody.ema?.publicId === publicId,
      "recovered session has another owner",
    );
    assert(
      recoveredOwner.headers.get("x-emanowa-auth-kind") === "registered",
      "recovered owner session was not marked registered",
    );

    const invalidOtp = await recovered.post("/api/v1/auth/email/verify", {
      flow: "recover",
      email,
      token: "000000",
    });
    assert(invalidOtp.status === 400, "invalid OTP must return 400");
    const signout = await recovered.post("/api/v1/auth/signout", {});
    assert(signout.status === 200, "signout failed");
    const signedOutOwner = await recovered.request(
      "/api/v1/me/emas?world=2027",
    );
    assert(
      signedOutOwner.status === 401,
      "signed-out session still accessed owner data",
    );

    const conflict = new BrowserSession(baseUrl);
    await anonymous(conflict);
    const conflictResponse = await conflict.post("/api/v1/auth/email/link", {
      email,
    });
    assert(
      conflictResponse.status === 409,
      "existing email link must conflict",
    );
    const conflictBody = await responseJson(conflictResponse, "link conflict");
    assert(
      conflictBody.error.code === "ACCOUNT_LINK_CONFLICT",
      "wrong conflict code",
    );

    const unknownResponse = await new BrowserSession(baseUrl).post(
      "/api/v1/auth/email/recover",
      { email: `unknown-${randomUUID()}@example.test` },
    );
    assert(
      unknownResponse.status === 202,
      "unknown recovery must stay generic",
    );

    const deleteKey = randomUUID();
    const deleteBody = { expectedVersion: updated.receipt.version };
    const deleteResponse = await owner.request(`/api/v1/me/emas/${publicId}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": deleteKey,
      },
      body: JSON.stringify(deleteBody),
    });
    const deleted = await responseJson(deleteResponse, "HTTP delete");
    assert(deleteResponse.status === 200, JSON.stringify(deleted));
    const deleteReplayResponse = await owner.request(
      `/api/v1/me/emas/${publicId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": deleteKey,
        },
        body: JSON.stringify(deleteBody),
      },
    );
    const deleteReplay = await responseJson(
      deleteReplayResponse,
      "HTTP delete replay",
    );
    assert(deleteReplayResponse.status === 200, JSON.stringify(deleteReplay));
    assert(
      deleteReplay.receipt.version === deleted.receipt.version,
      "HTTP DELETE replay changed the immutable receipt",
    );
    const deleteKeyReuse = await owner.request(`/api/v1/me/emas/${publicId}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "idempotency-key": deleteKey,
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert(
      deleteKeyReuse.status === 409,
      "HTTP DELETE reused key with another body must be 409",
    );
    const afterDeleteOwner = await owner.request("/api/v1/me/emas?world=2027");
    const afterDeleteBody = await responseJson(
      afterDeleteOwner,
      "owner GET after delete",
    );
    assert(afterDeleteBody.ema === null, "deleted ema remained in owner GET");
    const deletedPublic = await fetch(
      `${baseUrl}/api/v1/worlds/2027/emas/${publicId}`,
      { cache: "no-store" },
    );
    assert(deletedPublic.status === 404, "deleted public API must be 404");
    passed(
      "メール追加・別Cookie OTP復帰・signoutとHTTP mutation再送・削除を確認",
    );
  } finally {
    await stopChild(child);
  }
}

async function main() {
  const status = readLocalStatus();
  const apiUrl = pick(status, "API_URL", "apiUrl", "api_url");
  const publishableKey = pick(
    status,
    "PUBLISHABLE_KEY",
    "ANON_KEY",
    "publishableKey",
    "anonKey",
  );
  const serviceRoleKey = pick(
    status,
    "SERVICE_ROLE_KEY",
    "SECRET_KEY",
    "serviceRoleKey",
    "secretKey",
  );
  const adminDatabaseUrl =
    pick(status, "DB_URL", "dbUrl", "db_url") ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  assert(
    apiUrl && publishableKey && serviceRoleKey,
    "local Supabase status is incomplete",
  );

  const adminPool = new Pool({
    connectionString: adminDatabaseUrl,
    max: 4,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(24).toString("base64url");
  const ownerPassword = randomBytes(24).toString("base64url");
  let appPool;
  let ownerPool;

  try {
    await adminPool.query(
      `alter role emanowa_app login password '${appPassword}'`,
    );
    await adminPool.query(
      `alter role emanowa_owner login password '${ownerPassword}'`,
    );
    const databaseUrl = roleConnectionUrl(
      adminDatabaseUrl,
      "emanowa_app",
      appPassword,
    );
    appPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
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
    await ownerPool.query(
      `create policy stage_c_integration_world_update on app_private.worlds
       for update to emanowa_owner using (true) with check (true)`,
    );
    await ownerPool.query(
      `update app_private.worlds
       set state = 'open', posting_enabled = true,
           opens_at = now() - interval '1 day', closes_at = now() + interval '1 day'
       where slug = '2027'`,
    );

    const [ownerId, strangerId] = await createUsers(apiUrl, serviceRoleKey, 2);
    const input = createInput(850, 850);
    const created = await createEma(appPool, ownerId, input);
    const publicId = created.public_id;
    const firstPatch = { expectedVersion: 1, nickname: "更新済み" };
    const patchKey = randomUUID();
    const first = await updateEma(
      appPool,
      ownerId,
      publicId,
      firstPatch,
      patchKey,
    );
    const replay = await updateEma(
      appPool,
      ownerId,
      publicId,
      firstPatch,
      patchKey,
    );
    assert(
      first.version === 2 && replay.version === 2,
      "PATCH replay changed version",
    );
    assert(replay.replayed === true, "PATCH replay was not marked replayed");
    await expectPostgresCode(
      () =>
        updateEma(
          appPool,
          ownerId,
          publicId,
          { expectedVersion: 1, nickname: "別内容" },
          patchKey,
        ),
      "P1005",
    );

    const race = await Promise.allSettled([
      updateEma(appPool, ownerId, publicId, {
        expectedVersion: 2,
        wishText: "同時更新A",
      }),
      updateEma(appPool, ownerId, publicId, {
        expectedVersion: 2,
        wishText: "同時更新B",
      }),
    ]);
    assert(
      race.filter((result) => result.status === "fulfilled").length === 1,
      "same-version PATCH race must have one winner",
    );
    assert(
      race
        .filter((result) => result.status === "rejected")
        .every((result) => postgresCode(result.reason) === "P1009"),
      "same-version PATCH loser must be VERSION_CONFLICT",
    );

    const ownerRow = await withContext(appPool, ownerId, (client) =>
      client.query("select * from app_private.get_owner_ema($1)", ["2027"]),
    );
    const currentVersion = ownerRow.rows[0].version;
    const privacy = await updateEma(appPool, ownerId, publicId, {
      expectedVersion: currentVersion,
      visibility: "unlisted",
      messageVisibility: "owner_only",
    });
    await expectPostgresCode(
      () =>
        updateEma(appPool, strangerId, publicId, {
          expectedVersion: privacy.version,
          nickname: "第三者",
        }),
      "P1008",
    );
    const projection = await adminPool.query(
      `select visibility, message_visibility, message_text
       from app_private.ema_public_projection where public_id = $1`,
      [publicId],
    );
    assert(
      projection.rows[0].visibility === "unlisted",
      "visibility was not synchronized",
    );
    assert(
      projection.rows[0].message_text === null,
      "private text remained in projection",
    );

    await expectPostgresCode(
      () => deleteEma(appPool, strangerId, publicId, privacy.version),
      "P1008",
    );
    await expectPostgresCode(
      () => deleteEma(appPool, ownerId, publicId, 1),
      "P1009",
    );
    const deleteKey = randomUUID();
    const deleted = await deleteEma(
      appPool,
      ownerId,
      publicId,
      privacy.version,
      deleteKey,
    );
    const deleteReplay = await deleteEma(
      appPool,
      ownerId,
      publicId,
      privacy.version,
      deleteKey,
    );
    assert(
      deleted.version === deleteReplay.version,
      "DELETE replay changed receipt",
    );
    assert(
      deleteReplay.replayed === true,
      "DELETE replay was not marked replayed",
    );

    const tombstone = await adminPool.query(
      `select status, wish_text, nickname,
        exists(select 1 from app_private.slot_occupancy o where o.ema_id = e.id) as occupied,
        exists(select 1 from app_private.ema_public_projection p where p.ema_id = e.id) as projected
       from app_private.emas e where public_id = $1`,
      [publicId],
    );
    assert(
      tombstone.rows[0].status === "deleted",
      "ema did not become a tombstone",
    );
    assert(
      tombstone.rows[0].wish_text === null &&
        tombstone.rows[0].nickname === null,
      "deleted text was not scrubbed",
    );
    assert(
      !tombstone.rows[0].occupied && !tombstone.rows[0].projected,
      "delete left occupancy/projection",
    );

    const oldCreateReplay = await createEma(
      appPool,
      ownerId,
      input,
      created.idempotencyKey,
    );
    assert(
      oldCreateReplay.public_id === publicId,
      "old create replay changed public ID",
    );
    const replacement = await createEma(appPool, ownerId, input);
    assert(replacement.public_id !== publicId, "deleted public ID was reused");
    passed(
      "DBでPATCH冪等性・version競合・第三者404・公開縮小・DELETE抹消・新ID再配置を確認",
    );

    await verifyHttpAndEmail({
      adminPool,
      apiUrl,
      publishableKey,
      databaseUrl,
    });
  } finally {
    if (appPool) await appPool.end();
    if (ownerPool) {
      await ownerPool
        .query(
          "drop policy if exists stage_c_integration_world_update on app_private.worlds",
        )
        .catch(() => undefined);
      await ownerPool.end();
    }
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
