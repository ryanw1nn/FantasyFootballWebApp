// Applies db/migrations/*.sql in filename order, once each, inside a
// transaction. Applied files are recorded in schema_migrations, so a migration
// that has already run is never re-run.
//
//   npm run db:migrate    apply everything pending
//   npm run db:status     list applied and pending, apply nothing
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, describeTarget } from "./pool.mjs";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

function migrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function appliedFilenames(client) {
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((row) => row.filename));
}

async function applyMigration(client, filename) {
  const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf-8");

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`${filename} failed, rolled back: ${err.message}`, { cause: err });
  }
}

async function migrate(client) {
  const applied = await appliedFilenames(client);
  const pending = migrationFiles().filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log("Up to date — nothing to apply.");
    return;
  }

  for (const filename of pending) {
    await applyMigration(client, filename);
    console.log(`applied  ${filename}`);
  }
  console.log(`\n${pending.length} migration(s) applied.`);
}

async function status(client) {
  const applied = await appliedFilenames(client);
  const files = migrationFiles();

  if (files.length === 0) {
    console.log("No migration files yet.");
    return;
  }
  for (const filename of files) {
    console.log(`${applied.has(filename) ? "applied" : "pending"}  ${filename}`);
  }

  const orphaned = [...applied].filter((name) => !files.includes(name));
  for (const filename of orphaned) {
    console.log(`MISSING  ${filename} — recorded as applied but the file is gone`);
  }
}

const client = await pool.connect();
try {
  console.log(`${describeTarget()}\n`);
  await client.query(TRACKING_TABLE);
  await (process.argv[2] === "status" ? status(client) : migrate(client));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
