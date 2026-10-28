// Applies every SQL file in db/migrations that has not been applied yet.
// Usage: npm run db:migrate   (reads DATABASE_URL from .env or the environment)
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadEnv } from "./env.mjs";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, onnotice: () => {} });
const dir = path.join(process.cwd(), "db", "migrations");

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`Applied ${file}`);
    count++;
  }
  console.log(count === 0 ? "Database is already up to date." : `Done: ${count} migration(s) applied.`);
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
