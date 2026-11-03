import { describe, expect, it, vi } from "vitest";

import type { PublicRuntimeConfig } from "@/config/public";
import { WORLD_2027 } from "@/config/worlds";

vi.mock("server-only", () => ({}));

import { createRobotsMetadata } from "./robots";
import { createSitemapMetadata } from "./sitemap";

const readyProduction = {
  environment: "production",
  appOrigin: "https://emanowa.test",
  featuredWorld: WORLD_2027,
  capabilities: { groups: false, fulfillment: false, payments: false },
  supabase: {
    url: "https://example.supabase.co",
    publishableKey: "publishable-test-key",
    configured: true,
  },
  captchaSiteKey: "captcha-site-key",
  captchaRequired: true,
  operations: {
    operatorName: "えまのわ運営テスト",
    contactUrl: "https://support.emanowa.test/contact",
  },
  publication: {
    ready: true,
    policyEffectiveDate: "2026-11-03",
    retention: {
      content: "投稿内容は削除されるまで保存します。",
      backups: "バックアップは30日後に削除します。",
      logs: "アクセスログは90日後に削除します。",
    },
  },
  services: {
    status: "ready",
    authConfigured: true,
    persistenceConfigured: true,
    writesAvailable: true,
    postingAvailable: true,
  },
} satisfies PublicRuntimeConfig;

describe("public crawler metadata", () => {
  it("blocks all crawling outside an approved production publication", () => {
    for (const config of [
      { ...readyProduction, environment: "staging" as const },
      {
        ...readyProduction,
        publication: { ...readyProduction.publication, ready: false },
      },
    ]) {
      expect(createRobotsMetadata(config)).toEqual({
        rules: { userAgent: "*", disallow: "/" },
      });
      expect(createSitemapMetadata(config)).toEqual([]);
    }
  });

  it("publishes only public routes after production approval", () => {
    const robots = createRobotsMetadata(readyProduction);
    const sitemap = createSitemapMetadata(readyProduction);

    expect(robots).toMatchObject({
      sitemap: "https://emanowa.test/sitemap.xml",
      host: "https://emanowa.test",
      rules: {
        allow: "/",
        disallow: expect.arrayContaining(["/api/", "/admin", "/me"]),
      },
    });
    expect(sitemap.map((entry) => entry.url)).toEqual([
      "https://emanowa.test",
      "https://emanowa.test/about",
      "https://emanowa.test/terms",
      "https://emanowa.test/privacy",
      "https://emanowa.test/w/2027",
    ]);
    expect(sitemap.some((entry) => entry.url.includes("/new"))).toBe(false);
    expect(sitemap.some((entry) => entry.url.includes("/edit"))).toBe(false);
  });
});
