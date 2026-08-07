/**
 * Idempotent migrations for the insights persistent cache.
 * Applies every data/migrations/*.sql in filename order against POSTGRES_URL.
 *
 * Run locally with:
 *   npm run migrate-insights-db
 * (reads POSTGRES_URL from .env.local automatically)
 */
import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

async function main() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("POSTGRES_URL is not set — add it to .env.local first (see README.md).");
    process.exit(1);
  }

  const migrationsDir = path.join(process.cwd(), "data", "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  const pool = new Pool({ connectionString });
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
