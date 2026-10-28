import { lstat, rm } from "node:fs/promises";

import { assertDevelopmentOnly, demoDirectory } from "./demo-fixture-lib.mjs";

assertDevelopmentOnly();

try {
  const stats = await lstat(demoDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "安全のため、通常のディレクトリではない .demo は削除しません。",
    );
  }
  await rm(demoDirectory, { recursive: true, force: false });
  console.info("開発用サンプル .demo/ を削除しました。復元はできません。");
} catch (error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    console.info("削除対象の開発用サンプルはありません。");
  } else {
    throw error;
  }
}
