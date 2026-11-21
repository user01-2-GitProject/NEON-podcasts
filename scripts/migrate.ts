// Applies db/schema.sql and db/migrations/*.sql to DATABASE_URL.
// Usage: DATABASE_URL=... node --experimental-strip-types scripts/migrate.ts
import { readFileSync, readdirSync } from "node:fs";
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
  const dbDir = join(__dirname, "..", "db");
  const migrationDir = join(dbDir, "migrations");
  const files = [
    join(dbDir, "schema.sql"),
    ...readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => join(migrationDir, file)),
  ];

  let applied = 0;
  for (const file of files) {
    // These migrations contain only simple statements; strip line comments first.
    const statements = readFileSync(file, "utf8")
      .replace(/^\s*--.*$/gm, "")
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await sql.query(statement);
      applied += 1;
    }
  }
  console.log(`Applied ${applied} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
