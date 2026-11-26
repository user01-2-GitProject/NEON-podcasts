const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const workflow = read(".github/workflows/backup.yml");
const backupScript = read("scripts/backup-db.sh");
const restoreScript = read("scripts/restore.sh");
const sources = [
  ["backup.yml", workflow],
  ["backup-db.sh", backupScript],
  ["restore.sh", restoreScript],
];

test("backup workflow runs daily at 04:00 UTC and allows manual runs", () => {
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /schedule:\s*\n\s*- cron:\s*"0 4 \* \* \*"/);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /run: bash scripts\/backup-db\.sh/);
});

test("workflow uses the documented R2 secret-name contract", () => {
  for (const name of [
    "DATABASE_URL",
    "R2_BACKUP_ACCOUNT_ID",
    "R2_BACKUP_BUCKET",
    "R2_BACKUP_ACCESS_KEY_ID",
    "R2_BACKUP_SECRET_ACCESS_KEY",
  ]) {
    assert.ok(
      workflow.includes(`\${{ secrets.${name} }}`),
      `workflow must read secrets.${name} by name`,
    );
  }
  // The backup bucket is intentionally separate from the audio storage secrets.
  assert.ok(!workflow.includes("secrets.S3_BUCKET"));
});

test("object key is backups/neon-YYYY-MM-DD.sql.gz", () => {
  assert.ok(
    backupScript.includes('key="backups/neon-$(date -u +%F).sql.gz"'),
    "backup must build a UTC-dated object key",
  );
  assert.ok(
    backupScript.includes('s3://${R2_BACKUP_BUCKET}/${key}'),
    "backup must upload to the dated key",
  );
  assert.ok(
    restoreScript.includes("^backups/neon-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.sql\\.gz$"),
    "restore must only accept the dated key shape",
  );
});

test("30-day retention is documented as an external R2 lifecycle rule", () => {
  const all = sources.map(([, source]) => source).join("\n");
  assert.match(all, /lifecycle rule/i);
  assert.match(all, /30 days/i);
});

test("no workflow or script leaks secret values or enables tracing", () => {
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /set -x\b|set -o xtrace|bash -x|\b--debug\b/i, name);
    assert.doesNotMatch(
      source,
      /(?:echo|printf|curl)[^\n]*\$(?:DATABASE_URL|R2_BACKUP_ACCESS_KEY_ID|R2_BACKUP_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY)\b/,
      `${name} must not print a secret`,
    );
    assert.doesNotMatch(source, /aws configure\b/i, `${name} must not write credentials to disk`);
  }
});

test("backup streams pg_dump through gzip into R2 under pipefail", () => {
  assert.ok(backupScript.includes("set -euo pipefail"));
  assert.ok(backupScript.includes('pg_dump "$DATABASE_URL" | gzip | aws'));
  assert.ok(backupScript.includes('AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"'));
  assert.ok(backupScript.includes("s3 cp --only-show-errors -"));
});

test("restore downloads and decompresses into psql with a safety confirm", () => {
  assert.ok(restoreScript.includes("set -euo pipefail"));
  assert.ok(restoreScript.includes('s3 cp --only-show-errors "$source" - \\'));
  assert.ok(restoreScript.includes("| gunzip \\"));
  assert.ok(restoreScript.includes('psql --no-psqlrc -v ON_ERROR_STOP=1 "$DATABASE_URL"'));
  assert.ok(restoreScript.includes("Type RESTORE to continue"));
  assert.ok(restoreScript.includes('RESTORE_CONFIRM:-'));
  assert.ok(restoreScript.includes("Refusing to restore unexpected key"));
  assert.ok(restoreScript.includes("credentials and target URL are not logged"));
});

test("backup and restore scripts are executable", () => {
  for (const scriptPath of ["scripts/backup-db.sh", "scripts/restore.sh"]) {
    const mode = fs.statSync(path.join(root, scriptPath)).mode;
    assert.ok(mode & 0o111, `${scriptPath} should be executable`);
  }
});
