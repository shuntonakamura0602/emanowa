import "server-only";

import { createPublicRuntimeConfig } from "@/config/public";
import {
  formatConfigurationIssues,
  parseServerEnvironment,
  toPublicRuntimeConfigSource,
  type ServerRuntimeConfig,
} from "@/server/config/parse";

let cachedConfig: ServerRuntimeConfig | undefined;
let reported = false;

export function getServerRuntimeConfig(): ServerRuntimeConfig {
  cachedConfig ??= parseServerEnvironment(process.env);

  if (
    !reported &&
    cachedConfig.issues.length > 0 &&
    process.env.NODE_ENV !== "test"
  ) {
    reported = true;
    console.warn(
      `[emanowa:config] 外部サービスの設定状態を確認してください。\n${formatConfigurationIssues(cachedConfig.issues)}`,
    );
  }

  return cachedConfig;
}

export function getPublicRuntimeConfig() {
  return createPublicRuntimeConfig(
    toPublicRuntimeConfigSource(getServerRuntimeConfig()),
  );
}

/**
 * Call this immediately before a persistent mutation. It intentionally does
 * not fall back to .demo data when production dependencies are absent.
 */
export function requireWriteConfiguration(): ServerRuntimeConfig {
  const config = getServerRuntimeConfig();
  if (!config.writesAvailable) {
    throw new Error(
      "永続化に必要な設定が不足しています。サーバーログの設定キーを確認してください。",
    );
  }
  return config;
}

/** New public posts have a stricter gate than recovery mutations. In a public
 * environment, owners can still narrow visibility or delete while publication
 * approval is pending, but creating another public record stays disabled. */
export function requirePostingConfiguration(): ServerRuntimeConfig {
  const config = getServerRuntimeConfig();
  if (!config.postingAvailable) {
    throw new Error(
      "新規投稿は現在利用できません。公開準備または受付状態を確認してください。",
    );
  }
  return config;
}

export type {
  ConfigurationIssue,
  ServerRuntimeConfig,
} from "@/server/config/parse";
