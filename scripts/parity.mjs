// The Phase 2 gate: the old routes still return what they returned before the
// database existed.
//
//   npm run api:parity
//
// It starts the server against DATABASE_URL, replays the thirteen requests
// baseline/ recorded from the JSON-backed server, and compares the two payloads
// field by field. Not JSON.stringify — key order is not a difference, and a
// stringified comparison reports one difference for a whole season anyway,
// which is exactly the resolution this needs to not have.
//
// Every difference is classified against scripts/divergences.mjs, which names
// the eleven places Phase 1 deliberately disagreed with the file and how many
// differences each is worth. The run fails on a difference that matches no kind
// AND on a kind whose count is off in either direction: a translation that
// stops being needed is a data change, and a whitelist that silently grows is
// the thing the whitelist exists to catch.
//
// Then the write, which the baseline cannot cover because capturing it would
// have rewritten the file it was freezing. That half runs against a scratch
// database built from scratch — migrate, import, recompute — so a PUT that
// moves standings, every body the server refuses, a 409, and a transaction
// forced to fail mid-flight all leave the working database alone.
//
// Deleted with the aliases in Phase 7. Until then it is what says the client
// can be repointed without reading it.
import { spawn, execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { promisify } from "util";
import "dotenv/config";

import {
  ABSENT,
  ROUTE_SECTIONS,
  classify,
  expectedCounts,
  titleOf,
} from "./divergences.mjs";
import { pinTlsVerification } from "../db/url.mjs";

const execFileAsync = promisify(execFile);

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = path.join(repoRoot, "baseline");
const SEASONS_JSON = path.join(repoRoot, "src", "data", "seasons.json");

const BOOT_TIMEOUT_MS = 15000;

/** The season and week the write half edits. Any two real teams would do. */
const WRITE_YEAR = 2021;
const WRITE_WEEK = 3;

/** The season whose standings are imported, and so refuses every write. */
const LOCKED_YEAR = 2020;

const pass = (line) => console.log(`  ok    ${line}`);
const fail = (line) => {
  failures.push(line);
  console.log(`  FAIL  ${line}`);
};

const failures = [];

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Every place two payloads differ, as { path, expected, actual }. `expected` is
 * the baseline's value and `actual` the server's, and either may be ABSENT.
 *
 * It stops descending at a difference: a key missing on one side is one
 * difference, not one per field of whatever it was holding. That is what makes
 * "2020 has no weeks" 17 rather than 103.
 */
function* differences(expected, actual, at = []) {
  if (expected === ABSENT || actual === ABSENT) {
    yield { path: at, expected, actual };
    return;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      yield { path: at, expected, actual };
      return;
    }
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
      yield* differences(
        i < expected.length ? expected[i] : ABSENT,
        i < actual.length ? actual[i] : ABSENT,
        [...at, String(i)]
      );
    }
    return;
  }

  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) {
      yield { path: at, expected, actual };
      return;
    }
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      yield* differences(
        Object.hasOwn(expected, key) ? expected[key] : ABSENT,
        Object.hasOwn(actual, key) ? actual[key] : ABSENT,
        [...at, key]
      );
    }
    return;
  }

  if (!Object.is(expected, actual)) yield { path: at, expected, actual };
}

function show(value) {
  if (value === ABSENT) return "<absent>";
  if (typeof value === "object" && value !== null) return JSON.stringify(value).slice(0, 60);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// The recorded routes
// ---------------------------------------------------------------------------

/**
 * Where a difference sits in the payload: which year, which section, and what
 * is left of the path once those are stripped. The whole-league payload is
 * keyed by year and the per-season ones are not, which is the only difference
 * between the two shapes.
 */
function locate(entry, path) {
  const depth = entry.kind === "all" ? 2 : 1;
  const year = entry.kind === "all" ? Number(path[0]) : entry.year;
  const section = path[depth - 1];

  return { year, section, path: path.slice(depth) };
}

/** The manifest's routes, told apart by their shape rather than re-listed. */
function recordedRoutes(manifest) {
  return manifest.routes.map((route) => {
    const weeks = route.route.match(/^\/api\/seasons\/(\d{4})\/weeks$/);
    const season = route.route.match(/^\/seasons\/(\d{4})$/);

    if (weeks) return { ...route, kind: "weeks", sections: "weeks", year: Number(weeks[1]) };
    if (season) return { ...route, kind: "season", sections: "season", year: Number(season[1]) };
    return { ...route, kind: "all", sections: "season", year: null };
  });
}

/**
 * Replays one recorded request and reports how its differences classified.
 * Returns true when the payload is exactly as expected.
 */
async function compareRoute(port, entry, years) {
  const res = await fetch(`http://127.0.0.1:${port}${entry.route}`);
  if (res.status !== entry.status) {
    fail(`${entry.route} answered ${res.status}, baseline recorded ${entry.status}`);
    return false;
  }

  const recorded = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, entry.file), "utf-8"));
  const live = await res.json();

  const counted = new Map();
  const unclassified = [];

  for (const raw of differences(recorded, live)) {
    const located = locate(entry, raw.path);
    const diff = { ...located, expected: raw.expected, actual: raw.actual };
    const kind = ROUTE_SECTIONS[entry.sections].includes(diff.section) ? classify(diff) : null;

    if (kind === null) {
      unclassified.push({ raw, diff });
      continue;
    }
    counted.set(kind, (counted.get(kind) ?? 0) + 1);
  }

  const expected = expectedCounts(entry.sections, years);
  const wrong = [...expected].filter(([key, n]) => (counted.get(key) ?? 0) !== n);

  if (unclassified.length === 0 && wrong.length === 0) {
    const total = [...counted.values()].reduce((sum, n) => sum + n, 0);
    pass(`${entry.route.padEnd(30)} ${String(total).padStart(3)} expected differences`);
    return true;
  }

  fail(entry.route);
  for (const [key, n] of wrong) {
    console.log(`          ${titleOf(key).padEnd(24)} expected ${n}, saw ${counted.get(key) ?? 0}`);
  }
  for (const { raw, diff } of unclassified.slice(0, 10)) {
    const where = [diff.year, diff.section, ...diff.path].join(".");
    console.log(`          unclassified  ${where}  ${show(raw.expected)} -> ${show(raw.actual)}`);
  }
  if (unclassified.length > 10) {
    console.log(`          ...and ${unclassified.length - 10} more unclassified`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Running a server
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

/** Starts server.js against `databaseUrl` and resolves once it answers. */
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

// ---------------------------------------------------------------------------
// The scratch database
// ---------------------------------------------------------------------------

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function isLocal(url) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Drops and recreates the scratch database, then migrates and loads it. */
async function buildScratch(scratchName, scratchUrl) {
  const admin = new pg.Client({
    connectionString: pinTlsVerification(withDatabase(process.env.DATABASE_URL, "postgres")),
  });
  await admin.connect();
  try {
    // The name is a constant in this file, never a caller's string, so the
    // identifier can be interpolated where a placeholder is not allowed.
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
    await admin.query(`CREATE DATABASE "${scratchName}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: scratchUrl };
  for (const script of ["db/migrate.mjs", "db/import.mjs", "db/recompute.mjs"]) {
    await execFileAsync(process.execPath, [script], { cwd: repoRoot, env });
  }
}

async function dropScratch(scratchName) {
  const admin = new pg.Client({
    connectionString: pinTlsVerification(withDatabase(process.env.DATABASE_URL, "postgres")),
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

async function getJson(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  return { status: res.status, body: await res.json() };
}

async function putWeek(port, year, week, matchups) {
  const res = await fetch(`http://127.0.0.1:${port}/api/seasons/${year}/weeks/${week}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchups }),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * The bodies 2.6 says must never reach the DELETE, each with the reason it is
 * refused. Every one is a valid week with one thing wrong, so a 200 here means
 * the check is missing rather than the body being wrong twice over.
 */
function invalidBodies(matchups, index) {
  const at = (patch) => matchups.map((m, i) => (i === index ? { ...m, ...patch } : m));

  return [
    ["a 4000-point score", at({ team1Score: 4000 })],
    ["an unknown key", at({ team1_score: 12 })],
    ["a status the column does not hold", at({ status: "consolation" })],
    ["a 200-character label", at({ label: "x".repeat(200) })],
    ["a team playing itself", at({ team2: matchups[index].team1 })],
    ["33 matchups", [...matchups, ...Array(33 - matchups.length).fill(matchups[index])]],
  ];
}

/** A connection to the scratch database, for the one check that needs SQL. */
async function scratchClient(scratchUrl) {
  const client = new pg.Client({ connectionString: pinTlsVerification(scratchUrl) });
  await client.connect();
  return client;
}

/**
 * The rollback. Every body the server refuses is refused before the DELETE, so
 * the only way to fail *between* the INSERTs and the COMMIT is to make the
 * INSERT itself fail — a constraint the scratch database wears for one request.
 * If the transaction is not a transaction, the week comes back empty.
 */
async function checkRollback(server, scratchUrl, before, matchups) {
  const client = await scratchClient(scratchUrl);
  try {
    await client.query(
      `ALTER TABLE matchups ADD CONSTRAINT parity_rollback_probe
         CHECK (week <> ${WRITE_WEEK}) NOT VALID`
    );

    const broken = await putWeek(server.port, WRITE_YEAR, WRITE_WEEK, matchups);
    if (broken.status !== 500) {
      fail(`the forced INSERT failure answered ${broken.status}, not 500`);
      return;
    }
  } finally {
    await client.query(`ALTER TABLE matchups DROP CONSTRAINT IF EXISTS parity_rollback_probe`);
    await client.end();
  }

  const { body: after } = await getJson(server.port, `/seasons/${WRITE_YEAR}`);
  const moved = [...differences(before, after)];
  if (moved.length === 0) {
    pass(`a failed INSERT rolled the DELETE back: ${WRITE_YEAR} week ${WRITE_WEEK} intact`);
  } else {
    fail(`the failed write left ${moved.length} differences behind — the DELETE stood`);
  }
}

const byName = (standings) => new Map(standings.map((row) => [row.name, row]));
const cents = (value) => Math.round(value * 100);

/** The matchup the round-trip flips: two real teams and a decided result. */
function pickMatchup(week) {
  const index = week.matchups.findIndex(
    (m) =>
      m.team1 !== "BYE" &&
      m.team2 !== "BYE" &&
      typeof m.team1Score === "number" &&
      typeof m.team2Score === "number" &&
      m.team1Score !== m.team2Score
  );
  if (index === -1) throw new Error(`no decided matchup in ${WRITE_YEAR} week ${WRITE_WEEK}`);
  return index;
}

/**
 * Swapping one week's two scores flips exactly one game, and db/standings.mjs
 * says precisely what that is worth: the winner and loser trade a win for a
 * loss, each side's pf and pa move by the difference between the two scores,
 * and every other team's record is untouched. Places are free to move.
 */
function checkFlip(before, after, edited) {
  const [a, b] = [edited.team1, edited.team2];
  const delta = edited.team2Score - edited.team1Score;
  const was = byName(before.standings);
  const now = byName(after.standings);

  const wonBefore = edited.team1Score > edited.team2Score ? a : b;
  const lostBefore = wonBefore === a ? b : a;

  const moves = [
    [a, +delta],
    [b, -delta],
  ];

  for (const [name, shift] of moves) {
    const from = was.get(name);
    const to = now.get(name);
    if (cents(to.pf) !== cents(from.pf + shift) || cents(to.pa) !== cents(from.pa - shift)) {
      return `${name}: pf/pa did not move by ${shift.toFixed(2)}`;
    }
  }

  if (now.get(wonBefore).wins !== was.get(wonBefore).wins - 1) {
    return `${wonBefore} did not lose the win it had`;
  }
  if (now.get(lostBefore).wins !== was.get(lostBefore).wins + 1) {
    return `${lostBefore} did not gain the win`;
  }

  for (const [name, row] of was) {
    if (name === a || name === b) continue;
    const to = now.get(name);
    if (
      to.wins !== row.wins ||
      to.losses !== row.losses ||
      cents(to.pf) !== cents(row.pf) ||
      cents(to.pa) !== cents(row.pa)
    ) {
      return `${name} moved, and only two teams played the edited game`;
    }
  }

  return null;
}

async function runWriteChecks(scratchName, scratchUrl) {
  await buildScratch(scratchName, scratchUrl);
  const server = await startServer(scratchUrl);

  try {
    const { body: before } = await getJson(server.port, `/seasons/${WRITE_YEAR}`);
    const week = before.weeks[WRITE_WEEK];
    const index = pickMatchup(week);
    const original = week.matchups[index];

    // Every way a body can be wrong, one at a time.
    for (const [what, body] of invalidBodies(week.matchups, index)) {
      const rejected = await putWeek(server.port, WRITE_YEAR, WRITE_WEEK, body);
      if (rejected.status === 400) {
        pass(`PUT with ${what}`.padEnd(46) + `400 ${rejected.body.error}`);
      } else {
        fail(`${what} answered ${rejected.status}, not 400`);
      }
    }

    const { body: unchanged } = await getJson(server.port, `/seasons/${WRITE_YEAR}`);
    if ([...differences(before, unchanged)].length === 0) {
      pass("the rejected writes left the season untouched");
    } else {
      fail("a rejected write changed the season");
    }

    await checkRollback(server, scratchUrl, before, week.matchups);

    const locked = await putWeek(server.port, LOCKED_YEAR, 1, []);
    if (locked.status === 409) {
      pass(`PUT ${LOCKED_YEAR} week 1  409 ${locked.body.error}`);
    } else {
      fail(`${LOCKED_YEAR} answered ${locked.status}, not 409`);
    }

    // The round trip: flip one game by swapping its two scores.
    const flipped = week.matchups.map((m, i) =>
      i === index ? { ...m, team1Score: m.team2Score, team2Score: m.team1Score } : m
    );
    const written = await putWeek(server.port, WRITE_YEAR, WRITE_WEEK, flipped);
    if (written.status !== 200 || written.body.success !== true) {
      fail(`the write answered ${written.status}`);
    } else {
      const { body: after } = await getJson(server.port, `/seasons/${WRITE_YEAR}`);
      const wrong = checkFlip(before, after, original);
      if (wrong === null) {
        pass(
          `flipping ${original.team1} ${original.team1Score} - ` +
            `${original.team2} ${original.team2Score} moved exactly two standings rows`
        );
      } else {
        fail(`the standings did not move as db/standings.mjs says: ${wrong}`);
      }
    }

    // Re-import, and the season is the one the run started with.
    const env = { ...process.env, DATABASE_URL: scratchUrl };
    for (const script of ["db/import.mjs", "db/recompute.mjs"]) {
      await execFileAsync(process.execPath, [script], { cwd: repoRoot, env });
    }

    const { body: restored } = await getJson(server.port, `/seasons/${WRITE_YEAR}`);
    const remaining = [...differences(before, restored)];
    if (remaining.length === 0) {
      pass(`re-import restored ${WRITE_YEAR} exactly`);
    } else {
      fail(`re-import left ${remaining.length} differences in ${WRITE_YEAR}`);
    }
  } finally {
    server.stop();
    await dropScratch(scratchName);
  }
}

// ---------------------------------------------------------------------------

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  if (!fs.existsSync(path.join(BASELINE_DIR, "manifest.json"))) {
    throw new Error(
      "baseline/manifest.json is missing. Regenerate it from the json-truth tag:\n" +
        "  git stash && git checkout json-truth && npm run baseline:capture"
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, "manifest.json"), "utf-8")
  );
  const years = manifest.years.map(Number);

  // Creating and dropping a database is not something to do by accident on a
  // connection string that turned out to be Neon.
  if (!isLocal(process.env.DATABASE_URL ?? "")) {
    throw new Error("DATABASE_URL is not local — the write checks build a scratch database");
  }

  console.log(`\nReads — ${manifest.routes.length} recorded payloads\n`);
  const server = await startServer(process.env.DATABASE_URL);
  try {
    for (const entry of recordedRoutes(manifest)) {
      await compareRoute(server.port, entry, entry.year === null ? years : [entry.year]);
    }
  } finally {
    server.stop();
  }

  const scratchName = `${new URL(process.env.DATABASE_URL).pathname.slice(1)}_parity`;
  console.log(`\nWrites — scratch database ${scratchName}\n`);
  await runWriteChecks(scratchName, withDatabase(process.env.DATABASE_URL, scratchName));

  // Phase 2's most valuable negative result: the file did not change.
  console.log("\nThe file\n");
  const sha = sha256File(SEASONS_JSON);
  if (sha === manifest.seasonsJsonSha256) {
    pass(`src/data/seasons.json  ${sha.slice(0, 8)}…${sha.slice(-5)}  unchanged`);
  } else {
    fail(`src/data/seasons.json changed\n          was ${manifest.seasonsJsonSha256}\n          now ${sha}`);
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\nParity holds: only the whitelisted divergences, at the counts they claim.\n");
}

main().catch((err) => {
  console.error(`\nParity run failed: ${err.message}\n`);
  process.exit(1);
});
