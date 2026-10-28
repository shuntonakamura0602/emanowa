import { randomBytes } from "node:crypto";

import pg from "pg";

const { Client } = pg;
const environment = process.env.EMANOWA_ENVIRONMENT ?? "development";

if (environment === "staging" || environment === "production") {
  throw new Error("このコマンドはローカル開発専用です。");
}

const adminUrl = new URL(
  process.env.SUPABASE_LOCAL_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
);

if (
  !["127.0.0.1", "localhost", "::1"].includes(adminUrl.hostname) ||
  adminUrl.port !== "54322"
) {
  throw new Error("ローカルSupabaseの127.0.0.1:54322だけを変更できます。");
}

const password = randomBytes(24).toString("base64url");
const client = new Client({ connectionString: adminUrl.toString() });

try {
  await client.connect();
  const role = await client.query(
    "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'emanowa_app'",
  );
  if (role.rowCount !== 1) {
    throw new Error("先に pnpm db:reset でmigrationを適用してください。");
  }
  if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
    throw new Error("emanowa_app が限定ロールではないため中止しました。");
  }

  // The password is generated at runtime and never written to the repository.
  // base64url contains no quote characters, so it is safe in this fixed DDL.
  await client.query(`alter role emanowa_app login password '${password}'`);

  const appUrl = new URL(adminUrl);
  appUrl.username = "emanowa_app";
  appUrl.password = password;
  console.log(
    ".env.local の DATABASE_URL に次を設定してください（ローカル専用）:",
  );
  console.log(`DATABASE_URL=${appUrl.toString()}`);
  console.log("pnpm db:reset を実行すると、この一時LOGIN設定は破棄されます。");
} finally {
  await client.end();
}
