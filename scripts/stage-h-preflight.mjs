#!/usr/bin/env node

import process from "node:process";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUIRED_OPTIONS = ["url", "environment", "world-slug"];
const PLACEHOLDER_MARKERS = [
  "外部サービス未接続",
  "外部サービスは未接続",
  "公開準備中",
  "運営者情報は未設定",
  "問い合わせ先は未設定",
  "TODO",
  "localhost:",
];

function usage() {
  return `えまのわ 段階H 読み取り専用preflight

使い方:
  pnpm stage-h:preflight -- \\
    --url https://<確定済みのorigin> \\
    --environment staging|production \\
    --world-slug <4桁のslug>

オプション:
  --timeout-ms <1000..30000>  1要求のタイムアウト（既定: 10000）
  --allow-http-loopback       ローカルmock検証専用。staging + loopbackだけ許可
  --help                      この説明を表示

このコマンドは固定された公開URLへGETだけを送り、redirect、Cookie、認証情報、
request bodyを使用しません。productionへの投稿・編集・削除・通報は行いません。`;
}

function parseArgs(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const values = new Map();
  let allowHttpLoopback = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") return { help: true };
    if (argument === "--allow-http-loopback") {
      if (allowHttpLoopback) {
        throw new Error("--allow-http-loopbackが重複しています。");
      }
      allowHttpLoopback = true;
      continue;
    }

    const match = /^--([a-z-]+)(?:=(.*))?$/u.exec(argument);
    if (!match) throw new Error(`不明な引数です: ${argument}`);

    const [, name, inlineValue] = match;
    if (![...REQUIRED_OPTIONS, "timeout-ms"].includes(name)) {
      throw new Error(`不明なオプションです: --${name}`);
    }
    if (values.has(name)) throw new Error(`--${name}が重複しています。`);

    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`--${name}の値がありません。`);
    }
    values.set(name, value);
  }

  for (const name of REQUIRED_OPTIONS) {
    if (!values.has(name)) throw new Error(`--${name}は必須です。`);
  }

  const environment = values.get("environment");
  if (environment !== "staging" && environment !== "production") {
    throw new Error(
      "--environmentはstagingまたはproductionを指定してください。",
    );
  }

  const worldSlug = values.get("world-slug");
  if (!/^\d{4}$/u.test(worldSlug)) {
    throw new Error("--world-slugは4桁の年度で指定してください。");
  }

  const timeoutMs = values.has("timeout-ms")
    ? Number(values.get("timeout-ms"))
    : DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `--timeout-msは${MIN_TIMEOUT_MS}から${MAX_TIMEOUT_MS}の整数で指定してください。`,
    );
  }

  const origin = parseExplicitOrigin(
    values.get("url"),
    environment,
    allowHttpLoopback,
  );

  return {
    help: false,
    origin,
    environment,
    worldSlug,
    timeoutMs,
  };
}

function parseExplicitOrigin(rawUrl, environment, allowHttpLoopback) {
  if (rawUrl !== rawUrl.trim()) {
    throw new Error("--urlの前後に空白を含めないでください。");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("--urlには完全なoriginを指定してください。");
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "--urlはuserinfo、path、query、fragmentを含まないoriginだけを指定してください。",
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const isLoopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname);
  if (
    url.protocol === "http:" &&
    environment === "staging" &&
    allowHttpLoopback &&
    isLoopback
  ) {
    return url.origin;
  }

  if (url.protocol === "https:" && !isLoopback) return url.origin;

  if (isLoopback) {
    throw new Error(
      "public staging/productionのoriginにlocalhostまたはloopbackは指定できません。",
    );
  }

  throw new Error(
    "staging/productionはHTTPS必須です。HTTPは明示したloopback mockだけで利用できます。",
  );
}

async function readTextLimited(response) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("応答bodyがpreflightの上限を超えています。");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function expectStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(
      `HTTP ${expected}を期待しましたが${response.status}でした。`,
    );
  }
}

function expectContentType(response, expectedPrefix) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(expectedPrefix)) {
    throw new Error(`Content-Typeが${expectedPrefix}ではありません。`);
  }
}

function expectNoStore(response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (
    !/(?:^|,)\s*(?:private\s*,\s*)?no-store(?:\s*(?:,|$))/iu.test(cacheControl)
  ) {
    throw new Error("Cache-Controlにno-storeがありません。");
  }
}

function expectNoSetCookie(response) {
  if (response.headers.has("set-cookie")) {
    throw new Error("公開GETがSet-Cookieを返しました。");
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON応答を解析できません。");
  }
}

function isExactStatusBody(value, expectedStatus) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    value.status === expectedStatus
  );
}

function expectCoreSecurityHeaders(response) {
  if (
    response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
  ) {
    throw new Error("X-Content-Type-Options: nosniffがありません。");
  }

  const referrerPolicy = response.headers.get("referrer-policy")?.toLowerCase();
  if (
    !referrerPolicy ||
    ![
      "no-referrer",
      "same-origin",
      "strict-origin",
      "strict-origin-when-cross-origin",
    ].includes(referrerPolicy)
  ) {
    throw new Error("安全なReferrer-Policyがありません。");
  }

  if (!response.headers.get("permissions-policy")) {
    throw new Error("Permissions-Policyがありません。");
  }

  const frameOptions = response.headers.get("x-frame-options")?.toUpperCase();
  const csp = response.headers.get("content-security-policy") ?? "";
  if (
    frameOptions !== "DENY" &&
    frameOptions !== "SAMEORIGIN" &&
    !/(?:^|;)\s*frame-ancestors\s+/iu.test(csp)
  ) {
    throw new Error("frame埋め込みを制限するheaderがありません。");
  }

  if (response.headers.has("x-powered-by")) {
    throw new Error("X-Powered-Byが公開されています。");
  }
}

function hasValidHsts(response) {
  const hsts = response.headers.get("strict-transport-security") ?? "";
  const match = /(?:^|;)\s*max-age=(\d+)(?:\s*;|$)/iu.exec(hsts);
  return Boolean(match && Number(match[1]) > 0);
}

function hasNoIndex(response, html) {
  const xRobotsTag = response.headers.get("x-robots-tag") ?? "";
  return (
    /(?:^|,)\s*noindex(?:\s*(?:,|$))/iu.test(xRobotsTag) ||
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/iu.test(
      html,
    ) ||
    /<meta\s+[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/iu.test(
      html,
    )
  );
}

function expectNoPlaceholders(html) {
  const found = PLACEHOLDER_MARKERS.find((marker) => html.includes(marker));
  if (found) {
    throw new Error(`公開準備用のplaceholderが残っています: ${found}`);
  }
}

function expectWorldContract(value, worldSlug) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.world === null ||
    typeof value.world !== "object" ||
    Array.isArray(value.world)
  ) {
    throw new Error("world APIの公開契約が不正です。");
  }

  const world = value.world;
  if (
    world.slug !== worldSlug ||
    world.width !== 1000 ||
    world.height !== 1000
  ) {
    throw new Error("world APIのslugまたはサイズが期待値と一致しません。");
  }
  if (!["preview", "open", "archived"].includes(world.state)) {
    throw new Error("world APIのstateが不正です。");
  }
  if (typeof world.acceptingPosts !== "boolean") {
    throw new Error("world APIのacceptingPostsがbooleanではありません。");
  }

  const opensAt = Date.parse(world.opensAt);
  const closesAt = Date.parse(world.closesAt);
  if (
    !Number.isFinite(opensAt) ||
    !Number.isFinite(closesAt) ||
    opensAt >= closesAt
  ) {
    throw new Error("world APIの受付期間が不正です。");
  }

  const capabilities = value.capabilities;
  if (
    capabilities === null ||
    typeof capabilities !== "object" ||
    capabilities.groups !== false ||
    capabilities.fulfillment !== false ||
    capabilities.payments !== false
  ) {
    throw new Error("P0で無効にすべきcapabilityが有効です。");
  }
}

function createReporter() {
  const results = [];
  const warnings = [];

  return {
    async check(name, operation) {
      try {
        await operation();
        results.push({ name, ok: true });
        console.log(`PASS  ${name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明な失敗";
        results.push({ name, ok: false, message });
        console.error(`FAIL  ${name}: ${message}`);
      }
    },
    warn(name, message) {
      warnings.push({ name, message });
      console.warn(`WARN  ${name}: ${message}`);
    },
    finish() {
      const failed = results.filter((result) => !result.ok);
      console.log(
        `\n結果: ${results.length - failed.length}/${results.length}件成功、` +
          `${failed.length}件失敗、${warnings.length}件警告`,
      );
      return failed.length === 0 ? 0 : 1;
    },
  };
}

async function run(options) {
  const reporter = createReporter();
  const baseUrl = new URL(`${options.origin}/`);

  async function get(path, accept) {
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl.origin) {
      throw new Error("検査pathが指定originの外へ出ました。");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: accept,
          "User-Agent": "emanowa-stage-h-preflight/1",
        },
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error(
          `redirect（HTTP ${response.status}）を拒否しました。正規originを指定してください。`,
        );
      }
      const text = await readTextLimited(response);
      return { response, text };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`要求が${options.timeoutMs}msでtimeoutしました。`);
      }
      if (error instanceof Error && error.message.startsWith("redirect")) {
        throw error;
      }
      throw new Error("公開URLへのGETに失敗しました。");
    } finally {
      clearTimeout(timeout);
    }
  }

  console.log("えまのわ 段階H 読み取り専用preflight");
  console.log(`対象origin: ${options.origin}`);
  console.log(`環境: ${options.environment}`);
  console.log(`world: ${options.worldSlug}`);
  console.log("方式: GETのみ / redirect拒否 / Cookie・認証情報・bodyなし\n");

  await reporter.check("liveness", async () => {
    const { response, text } = await get(
      "/api/health/live",
      "application/json",
    );
    expectStatus(response, 200);
    expectContentType(response, "application/json");
    expectNoStore(response);
    expectNoSetCookie(response);
    const body = parseJson(text);
    if (!isExactStatusBody(body, "live")) {
      throw new Error('bodyが正確な{"status":"live"}ではありません。');
    }
  });

  await reporter.check("readiness", async () => {
    const { response, text } = await get(
      "/api/health/ready",
      "application/json",
    );
    expectContentType(response, "application/json");
    expectNoStore(response);
    expectNoSetCookie(response);
    const body = parseJson(text);

    if (response.status === 503 && isExactStatusBody(body, "not_ready")) {
      throw new Error(
        "設定または依存先がnot_readyです。公開判定を止めました。",
      );
    }
    if (response.status !== 200 || !isExactStatusBody(body, "ready")) {
      throw new Error('HTTP 200と正確な{"status":"ready"}が必要です。');
    }
  });

  let homeResponse;
  let homeHtml = "";
  await reporter.check("公開トップ", async () => {
    const result = await get("/", "text/html");
    homeResponse = result.response;
    expectStatus(homeResponse, 200);
    expectContentType(homeResponse, "text/html");
    expectNoSetCookie(homeResponse);
    homeHtml = result.text;
    if (!homeHtml.includes("えまのわ")) {
      throw new Error("サービス名を確認できません。");
    }
    expectNoPlaceholders(homeHtml);
    if (
      options.environment === "production" &&
      hasNoIndex(homeResponse, homeHtml)
    ) {
      throw new Error("productionトップにnoindexがあります。");
    }
  });

  await reporter.check("security headers", async () => {
    if (!homeResponse) throw new Error("トップ応答を取得できませんでした。");
    expectCoreSecurityHeaders(homeResponse);

    if (options.environment === "production" && !hasValidHsts(homeResponse)) {
      throw new Error(
        "production配信に有効なStrict-Transport-Securityがありません。",
      );
    }
    if (options.environment === "staging" && !hasValidHsts(homeResponse)) {
      reporter.warn(
        "HSTS",
        "staging配信にStrict-Transport-Securityがありません。配信基盤を確認してください。",
      );
    }
    if (!homeResponse.headers.get("content-security-policy")) {
      reporter.warn(
        "CSP",
        "Content-Security-Policyがありません。導入時はNext.jsのnonce/hash設計を別途検証してください。",
      );
    }
  });

  for (const [name, path] of [
    ["サービス説明", "/about"],
    ["利用規約", "/terms"],
    ["プライバシー", "/privacy"],
    ["worldページ", `/w/${options.worldSlug}`],
  ]) {
    await reporter.check(name, async () => {
      const { response, text } = await get(path, "text/html");
      expectStatus(response, 200);
      expectContentType(response, "text/html");
      expectNoSetCookie(response);
      const html = text;
      if (!html.includes("えまのわ"))
        throw new Error("サービス名を確認できません。");
      expectNoPlaceholders(html);
      if (options.environment === "production" && hasNoIndex(response, html)) {
        throw new Error("production公開ページにnoindexがあります。");
      }
    });
  }

  await reporter.check("world公開API", async () => {
    const { response, text } = await get(
      `/api/v1/worlds/${options.worldSlug}`,
      "application/json",
    );
    expectStatus(response, 200);
    expectContentType(response, "application/json");
    expectNoStore(response);
    expectNoSetCookie(response);
    expectWorldContract(parseJson(text), options.worldSlug);
  });

  await reporter.check("operations readiness", async () => {
    const { response, text } = await get(
      "/api/health/operations",
      "application/json",
    );
    expectStatus(response, 200);
    expectContentType(response, "application/json");
    expectNoStore(response);
    expectNoSetCookie(response);
    const body = parseJson(text);
    if (!isExactStatusBody(body, "ready")) {
      throw new Error("operations readinessの応答契約が不正です。");
    }
  });

  await reporter.check("robots.txt", async () => {
    const { response, text: robots } = await get("/robots.txt", "text/plain");
    expectStatus(response, 200);
    expectContentType(response, "text/plain");
    expectNoSetCookie(response);
    const blocksAll = /^\s*disallow\s*:\s*\/\s*(?:#.*)?$/imu.test(robots);

    if (options.environment === "staging" && !blocksAll) {
      throw new Error(
        "stagingのrobots.txtがDisallow: /でクロールを拒否していません。",
      );
    }
    if (options.environment === "production" && blocksAll) {
      throw new Error("productionのrobots.txtが全ページを拒否しています。");
    }
    if (
      options.environment === "production" &&
      !robots.includes(`Sitemap: ${options.origin}/sitemap.xml`)
    ) {
      throw new Error(
        "productionのrobots.txtに正規originのsitemapがありません。",
      );
    }
    if (options.environment === "production") {
      const directives = robots
        .split(/\r?\n/u)
        .map((line) => line.trim().toLowerCase());
      for (const path of [
        "/api/",
        "/admin",
        "/me",
        "/w/*/new",
        "/w/*/e/*/edit",
      ]) {
        if (!directives.includes(`disallow: ${path}`)) {
          throw new Error(
            `robots.txtがprivate path ${path}を拒否していません。`,
          );
        }
      }
    }
    if (
      options.environment === "staging" &&
      homeResponse &&
      !hasNoIndex(homeResponse, homeHtml)
    ) {
      throw new Error(
        "stagingのトップにX-Robots-Tagまたはmeta robotsのnoindexがありません。",
      );
    }
  });

  if (options.environment === "production") {
    await reporter.check("sitemap.xml", async () => {
      const { response, text: sitemap } = await get(
        "/sitemap.xml",
        "application/xml",
      );
      expectStatus(response, 200);
      const contentType = response.headers.get("content-type") ?? "";
      if (!/(?:application|text)\/xml/iu.test(contentType)) {
        throw new Error("Content-TypeがXMLではありません。");
      }
      expectNoSetCookie(response);
      const expectedUrls = new Set([
        options.origin,
        `${options.origin}/about`,
        `${options.origin}/terms`,
        `${options.origin}/privacy`,
        `${options.origin}/w/${options.worldSlug}`,
      ]);
      const actualUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/giu)].map(
        (match) => match[1]?.replace(/\/$/u, ""),
      );
      if (
        actualUrls.length !== expectedUrls.size ||
        new Set(actualUrls).size !== expectedUrls.size ||
        actualUrls.some((url) => !url || !expectedUrls.has(url))
      ) {
        throw new Error(
          "sitemapはtop/about/terms/privacy/featured worldだけを含めてください。",
        );
      }
    });
  }

  return reporter.finish();
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "引数が不正です。";
    console.error(`引数エラー: ${message}\n`);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  return run(options);
}

process.exitCode = await main();
