import { lstat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const demoDirectory = fileURLToPath(
  new URL("../.demo/", import.meta.url),
);
export const demoFixturePath = fileURLToPath(
  new URL("../.demo/ema-fixtures.json", import.meta.url),
);

export function assertDevelopmentOnly() {
  const environment = process.env.EMANOWA_ENVIRONMENT ?? "development";
  if (
    process.env.NODE_ENV === "production" ||
    environment === "production" ||
    environment === "staging"
  ) {
    throw new Error(
      "デモデータは development / test でのみ作成・削除できます。",
    );
  }
}

export async function ensureSafeDemoDirectory() {
  try {
    const stats = await lstat(demoDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(".demo は通常のディレクトリである必要があります。");
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      await mkdir(demoDirectory, { recursive: true });
      return;
    }
    throw error;
  }
}
