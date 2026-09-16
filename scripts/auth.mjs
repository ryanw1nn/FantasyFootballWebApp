// The Phase 3 gate: a write with no cookie is refused, on every write route.
//
//   npm run api:auth
//   npm run api:auth -- --prove     also break the guard three ways, on purpose
//
// "A curl PUT with no cookie returns 401, for every write route" is a list of
// routes, and a list goes stale the week someone adds a route to it. So the
// script does not hold one: it walks the Express app's own router stack and
// sends every non-read route it finds. A write route added later is covered the
// day it is written, and if the walk ever finds nothing the run fails rather
// than passing by checking nothing.
//
// Everything runs against a scratch database (<db>_auth) built the documented
// way — migrate, import, recompute — and dropped afterwards. Two extra leagues
// live in it and nowhere else: `other`, with its own passphrase, proves an
// unlock does not travel between leagues, and `nohash`, with none, proves a
// league with no passphrase cannot be unlocked at all.
//
// --prove is the half that matters most. A gate nobody has watched fail proves
// nothing, so it removes the guard, then the legacy fallback, then the cookie
// rule, re-runs the whole suite against each, and reports what each break
// costs. It edits the three files in place and restores them in a finally,
// which is why it is a flag and not the default.
import { spawn, execFile } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { promisify } from "util";
import "dotenv/config";

import { hashPassphrase } from "../server/passphrase.mjs";
import { pinTlsVerification } from "../db/url.mjs";

const execFileAsync = promisify(execFile);

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = path.join(repoRoot, "baseline");

const BOOT_TIMEOUT_MS = 15000;

/** The league the working database has, and the two the scratch one adds. */
const LEAGUE = "fan-club";
const OTHER_LEAGUE = "other";
const NOHASH_LEAGUE = "nohash";

/** Known only to this process, and only for the life of the scratch database. */
const PASSPHRASE = "parity-gate-passphrase";
const OTHER_PASSPHRASE = "other-league-passphrase";
const WRONG_PASSPHRASE = "not-the-passphrase";

/** The season and week the write checks echo back unchanged. */
const WRITE_YEAR = 2021;
const WRITE_WEEK = 3;

/** express-rate-limit is configured for 10 unlock attempts per 15 minutes. */
const UNLOCK_LIMIT = 10;

/** What a discovered `:param` is worth when the route is actually sent. */
const PARAMS = {
  slug: LEAGUE,
  year: String(WRITE_YEAR),
  week: String(WRITE_WEEK),
  weekNum: String(WRITE_WEEK),
};

/** The two writes the guard lets through without an unlock, and nothing else. */
const OPEN_WRITES = [
  `POST /api/leagues/:slug/unlock`,
  `POST /api/leagues/:slug/lock`,
];

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * A run collects named results rather than printing as it goes, because --prove
 * needs to say which checks a broken guard costs — by name, not by count.
 */
class Run {
  constructor() {
    this.results = [];
  }

  record(ok, name, detail = "") {
    this.results.push({ ok, name, detail });
    return ok;
  }

  /** `ok` decides; `name` is what --prove reports when the check stops passing. */
  check(ok, name, detail = "") {
    return this.record(Boolean(ok), name, detail);
  }

  section(title) {
    this.results.push({ section: title });
  }

  get failures() {
    return this.results.filter((r) => r.ok === false);
  }

  print() {
    for (const result of this.results) {
      if (result.section !== undefined) {
        console.log(`\n${result.section}\n`);
        continue;
      }
      const mark = result.ok ? "  ok  " : "  FAIL";
      console.log(`${mark}  ${result.name}${result.detail ? `  ${result.detail}` : ""}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function request(port, method, route, { cookie, body, contentType } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = contentType ?? "application/json";

  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not every response is JSON; the status is what these checks read.
  }

  return {
    status: res.status,
    json,
    text,
    setCookie: res.headers.getSetCookie?.() ?? [],
  };
}

/** The `ffc.sid=…` pair from a Set-Cookie, ready to send back as Cookie. */
function sessionCookie(setCookie) {
  const header = setCookie.find((value) => value.startsWith("ffc.sid="));
  return header === undefined ? null : header.split(";")[0];
}

const unlock = (port, slug, passphrase, cookie) =>
  request(port, "POST", `/api/leagues/${slug}/unlock`, { body: { passphrase }, cookie });

const lock = (port, slug, cookie) =>
  request(port, "POST", `/api/leagues/${slug}/lock`, { cookie });

// ---------------------------------------------------------------------------
// The router walk
// ---------------------------------------------------------------------------

/**
 * Every route the app actually mounts, as { method, path }, read off Express's
 * own stack rather than a list kept here. Importing the app builds its pool, so
 * this runs against the scratch database and closes it again.
 */
async function discoverRoutes(scratchUrl) {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = scratchUrl;

  try {
    const { app } = await import("../server/index.js");
    const { pool } = await import("../db/pool.mjs");

    const stack = app.router?.stack ?? app._router?.stack ?? [];
    const routes = [];

    for (const layer of stack) {
      for (const inner of layer.handle?.stack ?? []) {
        if (inner.route === undefined) continue;
        for (const [method, on] of Object.entries(inner.route.methods)) {
          if (on) routes.push({ method: method.toUpperCase(), path: inner.route.path });
        }
      }
    }

    await pool.end();
    return routes;
  } finally {
    process.env.DATABASE_URL = previous;
  }
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `/api/leagues/:slug/unlock` with every param filled in. */
function fillParams(routePath) {
  return routePath.replace(/:([A-Za-z_]+)/g, (whole, name) => PARAMS[name] ?? whole);
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

/**
 * Every check, in one function, so --prove can run exactly the same suite
 * against a deliberately broken server and report the difference.
 *
 * `restart` hands back a fresh server on the same scratch database. It is used
 * twice over: a session that survives it came from Postgres and not from
 * memory, and the unlock rate limiter — which counts in memory — starts again,
 * which is the only way to spend a full budget of attempts on the 429.
 */
async function runSuite(run, { server, routes, restart }) {
  let port = server.port;

  // --- every write route, found rather than listed --------------------------

  run.section("Write routes — walked off the router stack, sent with no cookie");

  const writes = routes.filter((route) => !READ_METHODS.has(route.method));
  run.check(writes.length > 0, `the walk found ${writes.length} write routes`);

  const open = writes
    .map((route) => `${route.method} ${route.path}`)
    .filter((route) => OPEN_WRITES.includes(route));
  const guarded = writes.filter(
    (route) => !OPEN_WRITES.includes(`${route.method} ${route.path}`)
  );

  run.check(
    open.length === OPEN_WRITES.length,
    "the only writes open without an unlock are unlock and lock",
    open.join(", ")
  );

  for (const route of guarded) {
    const sent = fillParams(route.path);
    // The body is one the validator refuses, so a guard that has stopped
    // guarding answers 400 and fails the check rather than emptying a week.
    const res = await request(port, route.method, sent, { body: { matchups: null } });
    run.check(res.status === 401, `${route.method} ${sent}`, `${res.status}, no cookie`);
    run.check(
      sessionCookie(res.setCookie) === null,
      `${route.method} ${sent} set no cookie`
    );
  }

  const madeUp = await request(port, "POST", "/api/made/up", { body: {} });
  run.check(madeUp.status === 401, "POST a path that does not exist", `${madeUp.status}, not 404`);

  // --- the way through ------------------------------------------------------

  run.section("The way through");

  const wrong = await unlock(port, LEAGUE, WRONG_PASSPHRASE);
  run.check(wrong.status === 401, "unlock with the wrong passphrase", String(wrong.status));
  run.check(sessionCookie(wrong.setCookie) === null, "a failed unlock sets no cookie");

  const opened = await unlock(port, LEAGUE, PASSPHRASE);
  run.check(opened.status === 200, "unlock with the right passphrase", String(opened.status));
  run.check(opened.json?.canWrite === true, "unlock answers { canWrite: true }");

  const cookieHeader = opened.setCookie.find((value) => value.startsWith("ffc.sid=")) ?? "";
  let cookie = sessionCookie(opened.setCookie);
  run.check(cookie !== null, "unlock sets ffc.sid");
  run.check(/HttpOnly/i.test(cookieHeader), "the cookie is HttpOnly");
  run.check(/SameSite=Lax/i.test(cookieHeader), "the cookie is SameSite=Lax");

  const week = await currentWeek(port, cookie);

  const legacyWrite = await request(
    port,
    "PUT",
    `/api/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
    { cookie, body: { matchups: week.legacy } }
  );
  run.check(legacyWrite.status === 200, "PUT the alias with the cookie", String(legacyWrite.status));

  const leagueWrite = await request(
    port,
    "PUT",
    `/api/leagues/${LEAGUE}/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
    { cookie, body: { matchups: week.league } }
  );
  run.check(leagueWrite.status === 200, "PUT the league route with the cookie", String(leagueWrite.status));

  const locked = await lock(port, LEAGUE, cookie);
  run.check(locked.status === 204, "lock", String(locked.status));

  for (const [label, route, body] of [
    ["the alias", `/api/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`, week.legacy],
    [
      "the league route",
      `/api/leagues/${LEAGUE}/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
      week.league,
    ],
  ]) {
    const after = await request(port, "PUT", route, { cookie, body: { matchups: body } });
    run.check(after.status === 401, `PUT ${label} after lock`, String(after.status));
  }

  // --- access stays with its league ----------------------------------------

  run.section("Access stays with its league");

  const reopened = await unlock(port, LEAGUE, PASSPHRASE);
  cookie = sessionCookie(reopened.setCookie) ?? cookie;

  const crossed = await request(
    port,
    "PUT",
    `/api/leagues/${OTHER_LEAGUE}/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
    { cookie, body: { matchups: [] } }
  );
  run.check(
    crossed.status === 401,
    `a ${LEAGUE} cookie writing to ${OTHER_LEAGUE}`,
    String(crossed.status)
  );

  const noHash = await unlock(port, NOHASH_LEAGUE, OTHER_PASSPHRASE);
  run.check(
    noHash.status === 401,
    `unlocking ${NOHASH_LEAGUE}, which has no passphrase`,
    String(noHash.status)
  );
  run.check(sessionCookie(noHash.setCookie) === null, "a league with no passphrase sets no cookie");

  // --- the edges ------------------------------------------------------------

  run.section("The edges");

  const plain = await request(
    port,
    "PUT",
    `/api/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
    { cookie, body: JSON.stringify({ matchups: week.legacy }), contentType: "text/plain" }
  );
  run.check(plain.status === 415, "a text/plain PUT with a valid cookie", String(plain.status));

  const reads = [
    ...recordedRoutes(),
    "/api/leagues",
    `/api/leagues/${LEAGUE}`,
    `/api/leagues/${LEAGUE}/seasons/${WRITE_YEAR}`,
    `/api/leagues/${LEAGUE}/seasons/${WRITE_YEAR}/weeks`,
    `/api/leagues/${LEAGUE}/session`,
  ];

  const cookied = [];
  for (const route of reads) {
    const res = await request(port, "GET", route);
    if (res.setCookie.length > 0) cookied.push(route);
  }
  run.check(cookied.length === 0, `${reads.length} GETs set no cookie`, cookied.join(", "));

  // Restarting proves two things at once: the session is in Postgres, and the
  // in-memory rate limiter starts again, which the 429 check below needs.
  const fresh = await restart();
  port = fresh.port;

  const survived = await request(
    port,
    "PUT",
    `/api/seasons/${WRITE_YEAR}/weeks/${WRITE_WEEK}`,
    { cookie, body: { matchups: week.legacy } }
  );
  run.check(
    survived.status === 200,
    "the same cookie still writes after a restart",
    String(survived.status)
  );

  let limited = null;
  for (let attempt = 1; attempt <= UNLOCK_LIMIT + 1; attempt++) {
    const res = await unlock(port, LEAGUE, WRONG_PASSPHRASE);
    if (attempt <= UNLOCK_LIMIT && res.status !== 401) {
      limited = `attempt ${attempt} answered ${res.status}, not 401`;
      break;
    }
    if (attempt === UNLOCK_LIMIT + 1 && res.status !== 429) {
      limited = `attempt ${attempt} answered ${res.status}, not 429`;
    }
  }
  run.check(limited === null, `attempt ${UNLOCK_LIMIT + 1} at the unlock is refused`, limited ?? "429");

  return port;
}

/** The thirteen routes baseline/ recorded, read from the manifest rather than listed. */
function recordedRoutes() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, "manifest.json"), "utf-8")
  );
  return manifest.routes.map((route) => route.route);
}

/**
 * The week the write checks send back, in both dialects, exactly as each route
 * serves it. Echoing a week rather than editing one keeps the gate about who
 * may write, not about what a write does — that is api:parity's half.
 */
async function currentWeek(port, cookie) {
  const legacy = await request(port, "GET", `/seasons/${WRITE_YEAR}`, { cookie });
  const league = await request(
    port,
    "GET",
    `/api/leagues/${LEAGUE}/seasons/${WRITE_YEAR}/weeks`,
    { cookie }
  );

  if (legacy.json?.weeks?.[WRITE_WEEK] === undefined) {
    throw new Error(`${WRITE_YEAR} week ${WRITE_WEEK} is missing from the scratch database`);
  }

  return {
    legacy: legacy.json.weeks[WRITE_WEEK].matchups,
    // position is the array order the route assigns on write, not a field it takes.
    league: league.json.weeks[WRITE_WEEK].matchups.map(({ position, ...rest }) => rest),
  };
}

// ---------------------------------------------------------------------------
// Proving it fails
// ---------------------------------------------------------------------------

/**
 * Three ways to break the thing being tested, each aimed at a different check.
 * `find` must appear exactly once in its file, so a break that no longer
 * applies stops the run instead of quietly doing nothing.
 */
const BREAKS = [
  {
    name: "app.use(requireWrite) removed",
    file: "server/index.js",
    find: "app.use(requireWrite);",
    replace: "// app.use(requireWrite);",
  },
  {
    name: "the DEFAULT_LEAGUE fallback dropped",
    file: "server/guard.mjs",
    find: "if (match === null) return DEFAULT_LEAGUE;",
    replace: "if (match === null) return null;",
  },
  {
    name: "saveUninitialized: true",
    file: "server/session.mjs",
    find: "saveUninitialized: false,",
    replace: "saveUninitialized: true,",
  },
];

/** Applies one break, hands the file back byte-identical whatever happens. */
async function withBreak(broken, body) {
  const file = path.join(repoRoot, broken.file);
  const original = fs.readFileSync(file, "utf-8");

  const occurrences = original.split(broken.find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${broken.file} no longer contains "${broken.find}" exactly once (${occurrences}). ` +
        `The break is stale — fix BREAKS in this file.`
    );
  }

  fs.writeFileSync(file, original.replace(broken.find, broken.replace));
  try {
    return await body();
  } finally {
    fs.writeFileSync(file, original);
  }
}

// ---------------------------------------------------------------------------
// The server and the scratch database
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(databaseUrl) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.resume();

  let exited = null;
  child.on("exit", (code) => (exited = code));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`server exited with code ${exited}\n${stderr}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/seasons`);
      if (res.ok) return { port, stop: () => child.kill() };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  child.kill();
  throw new Error(`server did not answer within ${BOOT_TIMEOUT_MS}ms\n${stderr}`);
}

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function isLocal(url) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function adminClient() {
  return new pg.Client({
    connectionString: pinTlsVerification(withDatabase(process.env.DATABASE_URL, "postgres")),
  });
}

/** Builds the scratch database the documented way, then seeds the two extra leagues. */
async function buildScratch(scratchName, scratchUrl) {
  const admin = adminClient();
  await admin.connect();
  try {
    // The name is a constant in this file, never a caller's string, so the
    // identifier can be interpolated where a placeholder is not allowed.
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${scratchName}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: scratchUrl };
  for (const script of ["db/migrate.mjs", "db/import.mjs", "db/recompute.mjs"]) {
    await execFileAsync(process.execPath, [script], { cwd: repoRoot, env });
  }

  const client = new pg.Client({ connectionString: pinTlsVerification(scratchUrl) });
  await client.connect();
  try {
    // db:import truncates leagues, so the passphrases are set after it, never before.
    await client.query(`UPDATE leagues SET write_secret_hash = $1 WHERE slug = $2`, [
      await hashPassphrase(PASSPHRASE),
      LEAGUE,
    ]);

    for (const [slug, passphrase] of [
      [OTHER_LEAGUE, OTHER_PASSPHRASE],
      [NOHASH_LEAGUE, null],
    ]) {
      await client.query(
        `INSERT INTO leagues (slug, name, playoff_start_week, regular_season_weeks,
                              team_count, write_secret_hash)
         VALUES ($1, $2, 15, 14, 12, $3)`,
        [slug, slug, passphrase === null ? null : await hashPassphrase(passphrase)]
      );
    }
  } finally {
    await client.end();
  }
}

async function dropScratch(scratchName) {
  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// ---------------------------------------------------------------------------

/**
 * One suite run against a database and a server of its own. The scratch
 * database is rebuilt first, so a run that ends badly — which is the whole
 * point of --prove — cannot leave the next one reading half a season.
 */
async function runOnce(scratchName, scratchUrl, routes) {
  await buildScratch(scratchName, scratchUrl);

  const servers = [];
  const start = async () => {
    const server = await startServer(scratchUrl);
    servers.push(server);
    return server;
  };

  const run = new Run();
  try {
    await runSuite(run, {
      server: await start(),
      routes,
      restart: async () => {
        servers.at(-1).stop();
        return start();
      },
    });
  } finally {
    for (const server of servers) server.stop();
  }
  return run;
}

async function main() {
  const prove = process.argv.includes("--prove");

  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not set — the server refuses to boot without it");
  }
  if (!isLocal(process.env.DATABASE_URL ?? "")) {
    throw new Error("DATABASE_URL is not local — this run builds and drops a scratch database");
  }

  const scratchName = `${new URL(process.env.DATABASE_URL).pathname.slice(1)}_auth`;
  const scratchUrl = withDatabase(process.env.DATABASE_URL, scratchName);

  console.log(`\nScratch database ${scratchName} — migrate, import, recompute, two extra leagues`);

  let failed = 0;
  try {
    const routes = await discoverRoutes(scratchUrl);

    const run = await runOnce(scratchName, scratchUrl, routes);
    run.print();
    failed = run.failures.length;

    if (prove) {
      console.log("\n\nProving it fails — each break is applied, run, and undone\n");

      for (const broken of BREAKS) {
        const broken_run = await withBreak(broken, () => runOnce(scratchName, scratchUrl, routes));
        const names = broken_run.failures.map((f) => f.name);

        if (names.length === 0) {
          console.log(`  FAIL  ${broken.name}: every check still passed`);
          failed += 1;
          continue;
        }

        console.log(`  ok    ${broken.name} — ${names.length} check(s) fail:`);
        for (const name of names) console.log(`          ${name}`);
      }
    }
  } finally {
    await dropScratch(scratchName);
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\nWrites are closed: no cookie, no write, on every route the app mounts.\n");
}

main().catch((err) => {
  console.error(`\nAuth run failed: ${err.message}\n`);
  process.exit(1);
});
