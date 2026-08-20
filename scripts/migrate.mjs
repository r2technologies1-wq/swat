import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Put your Neon connection string in .env or Replit Secrets.");
  process.exit(1);
}

const needsSsl = /neon\.tech|sslmode=require/i.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) {
    console.log("No migrations found.");
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const seen = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (seen.rowCount) {
        console.log("already applied:", version);
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      console.log("applying:", version);
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
        [version],
      );
    }

    await client.query("COMMIT");
    console.log("migrations complete");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
