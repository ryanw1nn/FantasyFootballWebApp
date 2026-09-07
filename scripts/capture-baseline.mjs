// Records what the JSON-backed routes return today, so the cutover to Postgres
// has something to be diffed against.
//
//   npm run baseline:capture
//
// The Phase 2 gate is "the old and new routes return identical payloads." That
// claim is only checkable against a recorded copy of the old payloads, and the
// old payloads stop existing the moment server.js is edited. So this runs
// first, against the unmodified server, and its output is the answer key for
// every parity run that follows.
//
// Three things it deliberately does not do:
//
//   * It never issues the PUT. That route rewrites src/data/seasons.json, and
//     the file is the thing being frozen. The sha256 is taken before and after
//     the capture and compared, so a stray write fails the run instead of
//     quietly poisoning the baseline.
//   * It does not reformat. Response bodies are written byte for byte as the
//     server produced them — key order included, because key order is part of
//     what parity has to reproduce.
//   * It does not go in git. baseline/ is a duplicate of data already tracked;
//     it is regenerated from the tagged commit instead of stored.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEASONS_JSON = path.join(repoRoot, "src", "data", "seasons.json");
const OUT_DIR = path.join(repoRoot, "baseline");

const BOOT_TIMEOUT_MS = 15000;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

/** An unused port, so a server already running on 5001 is left alone. */
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

/** Starts the current server on `port` and resolves once it answers. */
async function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.resume();

  let exited = null;
  child.on("exit", (code) => (exited = code));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`server exited with code ${exited}\n${stderr}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/seasons`);
      if (res.ok) return child;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  child.kill();
  throw new Error(`server did not answer on port ${port} within ${BOOT_TIMEOUT_MS}ms`);
}

/** Fetches one route and writes its body unchanged. Returns a manifest entry. */
async function capture(port, route, file) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  const body = Buffer.from(await res.arrayBuffer());

  if (res.status !== 200) {
    throw new Error(`${route} returned ${res.status}, not 200`);
  }

  fs.writeFileSync(path.join(OUT_DIR, file), body);
  return {
    route,
    file,
    status: res.status,
    contentType: res.headers.get("content-type"),
    bytes: body.length,
    sha256: sha256(body),
  };
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function main() {
  const before = sha256File(SEASONS_JSON);
  const port = await freePort();
  const server = await startServer(port);

  try {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const entries = [await capture(port, "/seasons", "all-seasons.json")];

    // The years come from the payload rather than a constant, so a season added
    // to the file before the cutover is captured instead of silently skipped.
    const years = Object.keys(
      JSON.parse(fs.readFileSync(path.join(OUT_DIR, "all-seasons.json"), "utf-8"))
    ).sort();

    for (const year of years) {
      entries.push(await capture(port, `/seasons/${year}`, `season-${year}.json`));
      entries.push(
        await capture(port, `/api/seasons/${year}/weeks`, `weeks-${year}.json`)
      );
    }

    const after = sha256File(SEASONS_JSON);
    if (after !== before) {
      throw new Error(
        `src/data/seasons.json changed during capture — the baseline is not trustworthy.\n` +
          `  before ${before}\n  after  ${after}`
      );
    }

    const manifest = {
      capturedAt: new Date().toISOString(),
      commit: currentCommit(),
      node: process.version,
      // Asserted after every parity run: Phase 2's most valuable negative
      // result is that the file did not change.
      seasonsJsonSha256: before,
      years,
      routes: entries,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );

    const total = entries.reduce((sum, e) => sum + e.bytes, 0);
    console.log(`\nCaptured ${entries.length} responses for ${years.length} seasons:`);
    for (const e of entries) {
      console.log(`  ${e.route.padEnd(32)} ${String(e.bytes).padStart(7)} B  ${e.file}`);
    }
    console.log(`\n  total              ${(total / 1024).toFixed(1)} KB -> baseline/`);
    console.log(`  seasons.json       ${before}  (unchanged)`);
    console.log(`  commit             ${manifest.commit ?? "unknown"}\n`);
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(`\nCapture failed: ${err.message}\n`);
  process.exit(1);
});
