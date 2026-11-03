import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import pg from "pg";

const { Pool } = pg;
const repositoryRoot = process.cwd();
const WORLD_SLUG = "2027";
const RATE_LIMIT_SECRET = randomBytes(48).toString("base64url");
const CREATE_PERFORMANCE_RUN_ID = randomUUID();
const NETWORK_RECOVERY_MARKER = `段階G-通信復旧-${randomUUID()}`;
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1_024 },
  { width: 1_440, height: 1_000 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`✓ ${message}`);
}

function percentile(values, quantile) {
  const ordered = [...values].sort((first, second) => first - second);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * quantile) - 1),
  );
  return ordered[index];
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
    "stage-g browser fixtures are forbidden outside local test environments",
  );
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(
    localHosts.has(api.hostname) && localHosts.has(database.hostname),
    "stage-g browser verification requires local Supabase and Postgres",
  );
  assert(
    database.port === "54322",
    "stage-g browser verification requires local Postgres port 54322",
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

  post(pathname, body, extraHeaders = {}) {
    return this.request(pathname, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
  }
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned non-JSON (${response.status}): ${text.slice(0, 400)}`,
    );
  }
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

async function waitForServer(server, baseUrl, pathname = "/") {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness.\n${server.logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        cache: "no-store",
      });
      if (response.status < 500) return;
    } catch {
      // The production server may not have bound its port yet.
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

function createInput(x, y, marker) {
  return {
    x,
    y,
    wishText: marker,
    nickname: "段階G",
    category: "other",
    designId: "basic_wood",
    visibility: "public",
    messageVisibility: "public",
  };
}

async function createAnonymousSession(session) {
  const response = await session.post("/api/v1/auth/anonymous", {});
  const body = await readJson(response, "anonymous auth");
  assert(
    response.status === 200 && body.authenticated === true,
    `anonymous auth failed: ${response.status}`,
  );
}

async function verifyCreatePerformance(baseUrl, fixtureY) {
  const sessions = Array.from(
    { length: 20 },
    () => new BrowserSession(baseUrl),
  );
  await Promise.all(sessions.map((session) => createAnonymousSession(session)));

  const durations = [];
  const responses = await Promise.all(
    sessions.map(async (session, index) => {
      const startedAt = performance.now();
      const response = await session.post(
        `/api/v1/worlds/${WORLD_SLUG}/emas`,
        createInput(
          300 + index,
          fixtureY,
          `段階G-20同時-${CREATE_PERFORMANCE_RUN_ID}-${String(index).padStart(2, "0")}`,
        ),
        { "idempotency-key": randomUUID() },
      );
      durations.push(performance.now() - startedAt);
      const body = await readJson(response, `concurrent create ${index}`);
      return { response, body };
    }),
  );

  assert(
    responses.every(({ response }) => response.status === 201),
    `20 concurrent creates did not all succeed: ${responses
      .map(({ response }) => response.status)
      .join(",")}`,
  );
  assert(
    new Set(responses.map(({ body }) => body.receipt?.publicId)).size === 20,
    "20 concurrent creates did not return distinct receipts",
  );
  const p95Ms = percentile(durations, 0.95);
  assert(
    p95Ms < 2_000,
    `local 20-concurrent create p95 ${p95Ms.toFixed(2)}ms exceeded 2,000ms`,
  );
  passed(
    `投稿確定APIを20人で同時実行し、20件成功・p95 ${p95Ms.toFixed(2)}ms（ローカル）`,
  );
  return { p95Ms };
}

async function verifyChunkPerformance(baseUrl) {
  const durations = [];
  const sizes = [];
  for (let index = 0; index < 15; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(
      `${baseUrl}/api/v1/worlds/${WORLD_SLUG}/chunks?cx=0&cy=0`,
      { cache: "no-store" },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(response.status === 200, `dense chunk returned ${response.status}`);
    durations.push(performance.now() - startedAt);
    sizes.push(bytes.byteLength);
  }
  const p95Ms = percentile(durations, 0.95);
  const maxBytes = Math.max(...sizes);
  assert(
    maxBytes < 512 * 1_024,
    `dense chunk ${maxBytes} bytes exceeded 512 KiB`,
  );
  assert(maxBytes < 4 * 1_024 * 1_024, "dense chunk exceeded hard 4 MiB limit");
  passed(
    `密集400件chunkはp95 ${p95Ms.toFixed(2)}ms・最大${maxBytes.toLocaleString("ja-JP")} bytes（15回、ローカル）`,
  );
  return { p95Ms, maxBytes };
}

function formatAxeViolations(violations) {
  return violations
    .map(
      (violation) =>
        `${violation.id}(${violation.impact ?? "unknown"}): ${violation.nodes
          .flatMap((node) => node.target)
          .slice(0, 4)
          .join(", ")}`,
    )
    .join("; ");
}

async function assertAccessible(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert(
    result.violations.length === 0,
    `${label} has axe violations: ${formatAxeViolations(result.violations)}`,
  );
}

async function assertResponsiveLayout(page, label) {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert(
    layout.bodyWidth <= layout.viewport + 1 &&
      layout.documentWidth <= layout.viewport + 1,
    `${label} has horizontal overflow: ${JSON.stringify(layout)}`,
  );

  const undersized = await page
    .locator(
      "main button:visible, main .button:visible, main input:visible, main select:visible",
    )
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const input = element instanceof HTMLInputElement ? element : null;
          const target =
            input && ["checkbox", "radio"].includes(input.type)
              ? (input.closest("label") ?? input)
              : element;
          const bounds = target.getBoundingClientRect();
          return {
            label:
              element.getAttribute("aria-label") ??
              target.textContent?.trim().slice(0, 60) ??
              element.tagName,
            width: bounds.width,
            height: bounds.height,
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
  assert(
    undersized.length === 0,
    `${label} has controls below 44px: ${JSON.stringify(undersized.slice(0, 8))}`,
  );
}

async function verifyResponsiveAndAccessibility(browser, baseUrl, publicId) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport,
      locale: "ja-JP",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/w/${WORLD_SLUG}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "絵馬の地図" }).waitFor();
    await assertResponsiveLayout(page, `${viewport.width}px world`);
    await assertAccessible(page, `${viewport.width}px world`);
    await context.close();
  }

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const pages = [
    ["/", "home"],
    [`/w/${WORLD_SLUG}/new`, "create"],
    [`/w/${WORLD_SLUG}/new?near=${publicId}`, "invite"],
    [`/w/${WORLD_SLUG}/e/${publicId}`, "detail"],
    ["/me", "owner"],
  ];
  for (const [pathname, label] of pages) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
    if (label === "invite") {
      await page
        .getByRole("heading", { name: "友達の絵馬の近くに掛ける" })
        .waitFor();
      const candidates = page.getByLabel("近くの場所候補").getByRole("button");
      await candidates
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {
          throw new Error("390px invite did not expose a nearby candidate");
        });
      await candidates.first().click();
    }
    await assertResponsiveLayout(page, `390px ${label}`);
    await assertAccessible(page, `390px ${label}`);
    await page.close();
  }
  await context.close();

  const desktopContext = await browser.newContext({
    viewport: { width: 1_440, height: 1_000 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const invitePage = await desktopContext.newPage();
  await invitePage.goto(`${baseUrl}/w/${WORLD_SLUG}/new?near=${publicId}`, {
    waitUntil: "networkidle",
  });
  await invitePage
    .getByRole("heading", { name: "友達の絵馬の近くに掛ける" })
    .waitFor();
  const desktopCandidates = invitePage
    .getByLabel("近くの場所候補")
    .getByRole("button");
  await desktopCandidates
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {
      throw new Error("1440px invite did not expose a nearby candidate");
    });
  await desktopCandidates.first().click();
  await assertResponsiveLayout(invitePage, "1440px invite");
  await assertAccessible(invitePage, "1440px invite");
  await desktopContext.close();
  passed(
    "360/390/768/1440px（招待経路を含む）の横溢れ・主要44px操作領域・axe WCAG 2.2 AAを確認",
  );
}

async function verifyKeyboardDialogsAndImageFailure(
  browser,
  baseUrl,
  publicId,
) {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 1_000 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/w/${WORLD_SLUG}?x=10&y=10&z=64`, {
    waitUntil: "networkidle",
  });
  const canvas = page.getByRole("application");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.getByText("選択中").waitFor();
  const reducedMotion = await page.evaluate(() => {
    const sample = document.querySelector("button");
    const rootStyle = getComputedStyle(document.documentElement);
    const sampleStyle = sample ? getComputedStyle(sample) : null;
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollBehavior: rootStyle.scrollBehavior,
      transitionDuration: sampleStyle?.transitionDuration ?? null,
      animationDuration: sampleStyle?.animationDuration ?? null,
    };
  });
  assert(
    reducedMotion.matches && reducedMotion.scrollBehavior === "auto",
    `reduced motion media/CSS was not active: ${JSON.stringify(reducedMotion)}`,
  );
  assert(
    Number.parseFloat(reducedMotion.transitionDuration ?? "1") <= 0.00001 &&
      Number.parseFloat(reducedMotion.animationDuration ?? "1") <= 0.00001,
    `reduced motion did not minimize animation: ${JSON.stringify(reducedMotion)}`,
  );

  await page.goto(`${baseUrl}/w/${WORLD_SLUG}/e/${publicId}`, {
    waitUntil: "networkidle",
  });
  const shareOpener = page.getByRole("button", { name: "この絵馬を共有する" });
  await shareOpener.click();
  await page.getByRole("dialog", { name: "この絵馬を共有する" }).waitFor();
  await page.keyboard.press("Escape");
  await assert(
    await shareOpener.evaluate((element) => element === document.activeElement),
    "share dialog did not return focus to its opener",
  );

  const reportOpener = page.getByRole("button", { name: "この絵馬を通報する" });
  await reportOpener.click();
  await page.getByRole("dialog", { name: "この絵馬を通報する" }).waitFor();
  await page.keyboard.press("Escape");
  await assert(
    await reportOpener.evaluate(
      (element) => element === document.activeElement,
    ),
    "report dialog did not return focus to its opener",
  );

  await page.route(
    "**/api/v1/worlds/2027/emas/*/image?variant=square",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({
          error: {
            code: "TEMPORARILY_UNAVAILABLE",
            message: "一時的に処理できません。",
            requestId: randomUUID(),
          },
        }),
      }),
  );
  await shareOpener.click();
  await page.getByRole("button", { name: "画像を保存" }).click();
  await page
    .getByText(
      "共有画像を保存できませんでした。リンクのコピーやX・LINEでの共有は引き続き利用できます。",
    )
    .waitFor();
  await context.close();
  passed(
    "地図のキーボード操作・reduced motion・dialog focus復帰・画像失敗時の代替導線を確認",
  );
}

async function verifyLostResponseAndCrossTabAuth(
  browser,
  baseUrl,
  fixtureSlotNumber,
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
  });
  const creationPage = await context.newPage();
  await creationPage.goto(`${baseUrl}/w/${WORLD_SLUG}/new`, {
    waitUntil: "networkidle",
  });
  await creationPage
    .getByLabel("叶えたいことを書いてください")
    .fill(NETWORK_RECOVERY_MARKER);
  await creationPage.getByLabel("表示名（任意）").fill("通信復旧");
  await creationPage.getByLabel("場所の番号").fill(String(fixtureSlotNumber));
  await creationPage
    .getByRole("button", { name: "入力内容を確認する" })
    .click();
  await creationPage
    .getByRole("heading", { name: "この内容で掛けますか" })
    .waitFor();

  let serverReceipt = null;
  await creationPage.route(
    `**/api/v1/worlds/${WORLD_SLUG}/emas`,
    async (route, request) => {
      if (request.method() !== "POST") return route.continue();
      const response = await route.fetch();
      serverReceipt = await response.json();
      await route.abort("connectionreset");
    },
  );
  await creationPage.getByRole("button", { name: "この場所に掛ける" }).click();
  await creationPage
    .getByText(
      "送信結果を確認できませんでした。同じ内容・同じ送信番号で結果を確認します。",
    )
    .waitFor();
  assert(
    serverReceipt?.receipt?.publicId,
    "the interrupted response was not saved by the server",
  );
  await creationPage.unroute(`**/api/v1/worlds/${WORLD_SLUG}/emas`);
  await creationPage
    .getByRole("button", { name: "同じ内容で結果を確認する" })
    .click();
  await creationPage
    .getByRole("heading", { name: "願いを掛けました" })
    .waitFor();

  const privateResponse = await creationPage.evaluate(async () => {
    const response = await fetch("/api/v1/me/emas?world=2027", {
      cache: "no-store",
      credentials: "same-origin",
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  });
  assert(
    privateResponse.status === 200 &&
      privateResponse.body.includes(NETWORK_RECOVERY_MARKER),
    `owner response fixture was unavailable before cross-tab sign-out (${privateResponse.status})`,
  );

  const stalePage = await context.newPage();
  const controlPage = await context.newPage();
  await controlPage.goto(`${baseUrl}/me`, { waitUntil: "networkidle" });
  const ownerWish = controlPage.getByLabel("叶えたいことを書いてください");
  await ownerWish.waitFor();
  assert(
    (await ownerWish.inputValue()) === NETWORK_RECOVERY_MARKER,
    "control tab did not load the private owner fixture",
  );

  let releaseStaleResponse;
  const staleRelease = new Promise((resolve) => {
    releaseStaleResponse = resolve;
  });
  let markStaleIntercepted;
  const staleIntercepted = new Promise((resolve) => {
    markStaleIntercepted = resolve;
  });
  await stalePage.route("**/api/v1/me/emas?world=2027", async (route) => {
    markStaleIntercepted();
    await staleRelease;
    await route.fulfill({
      status: privateResponse.status,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      body: privateResponse.body,
    });
  });
  const staleNavigation = stalePage.goto(`${baseUrl}/me`, {
    waitUntil: "domcontentloaded",
  });
  await staleIntercepted;
  controlPage.once("dialog", (dialog) => dialog.accept());
  await controlPage.getByRole("button", { name: "ログアウト" }).click();
  releaseStaleResponse();
  await staleNavigation;
  await controlPage.getByText(/ログアウトしました/).waitFor();
  await stalePage.waitForTimeout(500);
  const staleContents = await stalePage.evaluate(() =>
    [
      document.body.innerText,
      ...[...document.querySelectorAll("input, textarea")].map(
        (element) => element.value,
      ),
    ].join("\n"),
  );
  assert(
    !staleContents.includes(NETWORK_RECOVERY_MARKER),
    "a stale owner response became visible after cross-tab sign-out",
  );

  await context.close();
  passed(
    "DB保存後の応答切断を同じ冪等キーで復元し、別タブのログアウト後は古い本人応答を表示しない",
  );
  return serverReceipt.receipt.publicId;
}

async function verifyDelayedAndExpiredOtp(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/me`, { waitUntil: "networkidle" });
  await page.route("**/api/v1/auth/email/recover", async (route) => {
    await delay(600);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({ accepted: true }),
    });
  });
  await page.getByLabel("メールアドレス").fill("stage-g@example.invalid");
  await page.getByRole("button", { name: "認証コードを送る" }).click();
  const sending = page.getByRole("button", { name: "送信しています…" });
  await sending.waitFor();
  assert(
    await sending.isDisabled(),
    "OTP delay did not lock repeat submission",
  );
  await page
    .getByText("期限切れの場合は、上のボタンから新しいコードを送れます。")
    .waitFor();

  await page.route("**/api/v1/auth/email/verify", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify({
        error: {
          code: "INVALID_OTP",
          message: "認証コードを確認できませんでした。",
          requestId: randomUUID(),
        },
      }),
    }),
  );
  await page.getByLabel("認証コード").fill("123456");
  await page.getByRole("button", { name: "認証コードを確認する" }).click();
  await page.waitForTimeout(750);
  const ownershipText = await page.locator(".email-ownership").innerText();
  assert(
    ownershipText.includes("認証コード") &&
      ownershipText.includes("期限") &&
      ownershipText.includes("再送"),
    `expired OTP guidance is incomplete: ${ownershipText}`,
  );
  await context.close();
  passed("OTP遅延中の多重送信防止と、期限切れ後の再送案内を実ブラウザーで確認");
}

async function verifyBrowserPerformance(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__emanowaLcp = null;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) window.__emanowaLcp = latest.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: "cellular4g",
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`${baseUrl}/w/${WORLD_SLUG}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const navigation = performance.getEntriesByType("navigation")[0];
    const transferred = [navigation, ...resources].reduce(
      (total, entry) =>
        total +
        ("transferSize" in entry && typeof entry.transferSize === "number"
          ? entry.transferSize
          : 0),
      0,
    );
    return { lcpMs: window.__emanowaLcp, transferBytes: transferred };
  });
  assert(
    typeof metrics.lcpMs === "number" && metrics.lcpMs <= 2_500,
    `mobile 4G LCP ${String(metrics.lcpMs)}ms exceeded the 2,500ms target`,
  );
  await context.close();

  const fpsContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ja-JP",
  });
  const fpsPage = await fpsContext.newPage();
  await fpsPage.goto(`${baseUrl}/w/${WORLD_SLUG}?x=10&y=10&z=64`, {
    waitUntil: "networkidle",
  });
  const canvas = fpsPage.getByRole("application");
  const box = await canvas.boundingBox();
  assert(box, "map canvas had no browser bounds");
  const frameMeasurement = fpsPage.evaluate(
    () =>
      new Promise((resolve) => {
        const startedAt = performance.now();
        let frames = 0;
        const sample = (now) => {
          frames += 1;
          if (now - startedAt >= 10_000) {
            resolve({ frames, elapsedMs: now - startedAt });
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await fpsPage.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await fpsPage.mouse.down();
  for (let index = 0; index <= 120; index += 1) {
    const progress = index / 120;
    await fpsPage.mouse.move(
      box.x + box.width * (0.7 - progress * 0.4),
      box.y + box.height * (0.5 + Math.sin(progress * Math.PI * 4) * 0.12),
    );
    await delay(82);
  }
  await fpsPage.mouse.up();
  const frames = await frameMeasurement;
  const fps = frames.frames / (frames.elapsedMs / 1_000);
  assert(
    fps >= 30,
    `10-second dense map interaction measured ${fps.toFixed(2)}fps`,
  );
  await fpsContext.close();
  passed(
    `mobile 4G/CPU×4のLCP ${metrics.lcpMs.toFixed(2)}ms・転送${metrics.transferBytes.toLocaleString("ja-JP")} bytes、密集地図10秒 ${fps.toFixed(2)}fps`,
  );
  return { ...metrics, fps };
}

async function verifyDatabaseOutage({
  browser,
  nextBinary,
  environment,
  databaseUrl,
  publicId,
}) {
  const port = 37_000 + Math.floor(Math.random() * 300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const unavailableUrl = new URL(databaseUrl);
  unavailableUrl.port = "54329";
  const server = startServer(nextBinary, port, {
    ...environment,
    APP_ORIGIN: baseUrl,
    DATABASE_URL: unavailableUrl.toString(),
  });
  try {
    await waitForServer(server, baseUrl);
    const response = await fetch(`${baseUrl}/api/v1/worlds/${WORLD_SLUG}`, {
      cache: "no-store",
    });
    const body = await readJson(response, "database outage API");
    assert(
      response.status === 503,
      `database outage returned ${response.status}`,
    );
    assert(
      response.headers.get("cache-control")?.includes("no-store"),
      "database outage response was cacheable",
    );
    assert(
      body.error?.code === "TEMPORARILY_UNAVAILABLE",
      "database outage did not return the safe public error contract",
    );
    assert(
      !JSON.stringify(body).includes(unavailableUrl.password),
      "database outage response exposed a credential",
    );

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ja-JP",
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/w/${WORLD_SLUG}/e/${publicId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { name: "画面を読み込めませんでした" })
      .waitFor({
        timeout: 20_000,
      });
    await page.getByRole("button", { name: "もう一度読み込む" }).waitFor();
    await assertAccessible(page, "database outage recovery page");
    await context.close();
    passed("DB接続不能時にno-store 503と、内部情報を含まない再試行画面を確認");
  } finally {
    await stopChild(server);
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
    max: 4,
    allowExitOnIdle: true,
  });
  const appPassword = randomBytes(32).toString("base64url");
  const adminAppPassword = randomBytes(32).toString("base64url");
  const nextBinary = path.join(repositoryRoot, "node_modules", ".bin", "next");
  let server;
  let browser;

  try {
    const fixture = await adminPool.query(
      `select ema.public_id, ema.wish_text
       from app_private.emas as ema
       where ema.status = 'active'
         and ema.visibility = 'public'
         and ema.message_visibility = 'public'
       order by ema.created_at desc, ema.public_id desc
       limit 1`,
    );
    assert(
      fixture.rowCount === 1,
      "run stage-d integration before stage-g browser verification",
    );
    const publicId = fixture.rows[0].public_id;
    const fixtureSlots = await adminPool.query(
      `with target_world as (
         select id from app_private.worlds where slug = $1
       ), create_rows as (
         select candidate_y
         from generate_series(300, 399) as candidate_y
         where not exists (
           select 1
           from app_private.slot_occupancy as occupancy
           join target_world on target_world.id = occupancy.world_id
           where occupancy.y = candidate_y
             and occupancy.x between 300 and 319
         )
         order by candidate_y
         limit 1
       ), recovery_slot as (
         select candidate_x, candidate_y
         from generate_series(350, 399) as candidate_y
         cross join generate_series(350, 399) as candidate_x
         where not exists (
           select 1
           from app_private.slot_occupancy as occupancy
           join target_world on target_world.id = occupancy.world_id
           where occupancy.x = candidate_x and occupancy.y = candidate_y
         )
         order by candidate_y, candidate_x
         limit 1
       )
       select
         create_rows.candidate_y as create_y,
         recovery_slot.candidate_y * 1000 + recovery_slot.candidate_x + 1 as recovery_slot_number
       from create_rows cross join recovery_slot`,
      [WORLD_SLUG],
    );
    assert(
      fixtureSlots.rowCount === 1,
      "no empty Stage G fixture range remains",
    );
    const createFixtureY = Number(fixtureSlots.rows[0].create_y);
    const recoverySlotNumber = Number(
      fixtureSlots.rows[0].recovery_slot_number,
    );

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
    const port = 36_000 + Math.floor(Math.random() * 500);
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

    execFileSync(nextBinary, ["build"], {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
    });
    server = startServer(nextBinary, port, environment);
    await waitForServer(server, baseUrl, `/api/v1/worlds/${WORLD_SLUG}`);

    const defaultChrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      (existsSync(defaultChrome) ? defaultChrome : undefined);
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--disable-background-timer-throttling"],
    });

    await verifyChunkPerformance(baseUrl);
    await verifyCreatePerformance(baseUrl, createFixtureY);
    await verifyResponsiveAndAccessibility(browser, baseUrl, publicId);
    await verifyKeyboardDialogsAndImageFailure(browser, baseUrl, publicId);
    await verifyLostResponseAndCrossTabAuth(
      browser,
      baseUrl,
      recoverySlotNumber,
    );
    await verifyDelayedAndExpiredOtp(browser, baseUrl);
    await verifyBrowserPerformance(browser, baseUrl);
    await verifyDatabaseOutage({
      browser,
      nextBinary,
      environment,
      databaseUrl,
      publicId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logs = redactLogs(server?.logs() ?? "", [
      appPassword,
      adminAppPassword,
      migrationDatabaseUrl,
      RATE_LIMIT_SECRET,
    ]);
    throw new Error(`${message}\nNext.js logs:\n${logs}`);
  } finally {
    if (browser) await browser.close();
    await stopChild(server);
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
