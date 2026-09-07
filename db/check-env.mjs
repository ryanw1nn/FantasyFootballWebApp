// Preflight: reports which Postgres each key points at, and its version.
// Prints hostnames and versions only — never a connection string.
//
//   npm run db:check
import "dotenv/config";
import pg from "pg";
import { pinTlsVerification } from "./url.mjs";

const KEYS = ["DATABASE_URL", "DATABASE_URL_PROD"];

function isNeon(host) {
  return /neon\.tech/.test(host);
}

async function probe(key) {
  const url = process.env[key];
  if (!url) return console.log(`${key.padEnd(18)} not set`);

  const { hostname, port } = new URL(url);
  const client = new pg.Client({ connectionString: pinTlsVerification(url) });

  try {
    await client.connect();
    const { rows } = await client.query("show server_version");
    console.log(
      `${key.padEnd(18)} ${hostname}:${port || 5432}  ` +
        `postgres ${rows[0].server_version}  ${isNeon(hostname) ? "[NEON]" : "[local]"}`
    );
    await client.end();
  } catch (err) {
    console.log(`${key.padEnd(18)} ${hostname}  FAILED: ${err.message}`);
  }
}

/** Any other loaded key holding a Postgres URL — names and hosts only. */
function discoverOtherKeys() {
  return Object.entries(process.env)
    .filter(([key, value]) => !KEYS.includes(key) && /^postgres(ql)?:\/\//.test(value ?? ""))
    .map(([key, value]) => `${key} -> ${new URL(value).hostname}`);
}

for (const key of KEYS) await probe(key);

const others = discoverOtherKeys();
if (others.length > 0) {
  console.log("\nOther keys holding a Postgres URL:");
  for (const line of others) console.log(`  ${line}`);
  console.log("Nothing in db/ reads these. Rename to one of the keys above.");
}

if (isNeon(process.env.DATABASE_URL ?? "")) {
  console.log(
    "\nWARNING: DATABASE_URL points at Neon. Everything in db/ reads that key," +
      "\nso `npm run db:reset` would target production. Move it to" +
      "\nDATABASE_URL_PROD and point DATABASE_URL at localhost:5433."
  );
}
