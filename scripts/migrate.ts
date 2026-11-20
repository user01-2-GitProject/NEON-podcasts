// Applies db/schema.sql to the database in DATABASE_URL.
// Usage: DATABASE_URL=... node --experimental-strip-types scripts/migrate.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = neon(url);
  const schema = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

  // Split on semicolons at line ends; good enough for this schema.
  const statements = schema
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`Applied ${statements.length} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
