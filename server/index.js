// App wiring and listen.
//
// The data comes from Postgres — there is no in-memory copy of a season and no
// file on disk to fall back to, so the process refuses to start without a
// reachable database rather than serving 500s on every request.
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { pool } from "./queries.mjs";
import { describeTarget } from "../db/pool.mjs";
import { router as legacyRoutes } from "./routes/legacy.js";
import { router as leagueRoutes } from "./routes/leagues.js";
import { router as sessionRoutes } from "./routes/session.js";
import { requireWrite } from "./guard.mjs";
import { isProduction, sessionMiddleware, sessionSecretProblem } from "./session.mjs";

const app = express();

// Render terminates TLS and forwards plain HTTP. Trusting X-Forwarded-* there
// lets Express see https and issue the secure cookie; trusting it locally would
// let any client pick its own IP for the unlock rate limiter.
if (isProduction) app.set("trust proxy", 1);

// Above the static handler, not merely above the routers: index.html and the
// bundle need the security headers and the gzip as much as a JSON read does,
// and neither middleware costs a round trip the way a session lookup would.
// helmet's default CSP is default-src 'self', which holds here because every
// script, style and font is same-origin and nothing is inline.
app.use(helmet());
app.use(compression());

// A refused connection arrives as an AggregateError with an empty message, one
// entry per address the host resolved to — so err.message alone logs nothing at
// all, which is the least useful thing a failing health check can say.
function describeError(err) {
  return err.message || err.errors?.map((e) => e.message).join("; ") || err.code;
}

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

// The built client, ahead of everything else: a real file is answered as a file,
// without a session lookup or a body parser in the way. Vite content-hashes
// everything under /assets/, so those can never go stale and are cached for a
// year; index.html carries the asset names and must not be, or a reader keeps an
// old shell asking for a bundle that no longer exists. `index: false` leaves "/"
// to the fallback below, which is the one place the shell is served.
app.use(
  express.static(dist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

// What the host polls, and what the uptime monitor polls. It answers for the
// service rather than the process, so it touches the database: a shell served
// beautifully while Postgres is unreachable is the outage nobody is paged for.
// Above the session middleware so a health check neither reads nor writes the
// session table, and well above the SPA fallback, which would otherwise answer
// it with a cheerful 200 of HTML.
app.get("/healthz", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error(`Health check failed: ${describeError(err)}`);
    res.status(503).json({ ok: false, error: "Database unreachable" });
  }
});

// Single-origin production serves the client and the API from one host, so
// there is no cross-origin request left to permit — and a CORS layer that
// nothing needs can only ever be too permissive. The dev server on 5173 is
// still a second origin, so development keeps it.
if (!isProduction) {
  app.use(
    cors({
      origin: "http://localhost:5173", // Vite dev server
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
}
app.use(sessionMiddleware());
// Ahead of the body parser, so a locked-out write never has its body read.
app.use(requireWrite);
app.use(express.json({ limit: "100kb" }));

app.use(sessionRoutes);
app.use(leagueRoutes);
app.use(legacyRoutes);

// Client-side routes: anything the static files and the API did not claim gets
// the SPA shell, so a typed-in deep link works the same as a click. No path
// pattern — Express 5's path-to-regexp rejects app.get("*") at boot — so the
// two kinds of request that must not receive HTML are excluded by hand. An API
// path that reaches here matched no route and is a JSON 404, because a fetch
// cannot parse an HTML page; a write that reaches here is a 404 rather than a
// 200 that quietly did nothing.
app.use((req, res) => {
  const isRead = req.method === "GET" || req.method === "HEAD";
  if (!isRead || req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }

  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(dist, "index.html"));
});

// A thrown RequestError is a 4xx the caller asked for; anything else is ours.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.status) return res.status(err.status).json({ error: err.message });

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Internal error" });
});

// An idle client dropped by the server must not take the process down with it.
pool.on("error", (err) => {
  console.error("Idle database client error:", err.message);
});

const PORT = process.env.PORT || 5001;

// Render sends SIGTERM on every deploy and kills the process about ten seconds
// later. The request worth protecting is a save: a PUT deletes a week before it
// reinserts it, and the client does not retry, so a socket dropped mid-write is
// the one failure this app cannot explain to the person who caused it. Stop
// listening, let what is in flight finish, close the pool, exit 0. SIGINT takes
// the same path, so Ctrl-C locally exercises the code Render will run.
const SHUTDOWN_GRACE_MS = 5000;

function shutdownOn(server) {
  let closing = false;

  const close = (signal) => {
    // A second Ctrl-C means the operator is done waiting.
    if (closing) process.exit(1);
    closing = true;
    console.log(`\n${signal} received, shutting down.`);

    // A shutdown that hangs on one stuck connection is worse than one that
    // gives up: the host kills it later and harder, having waited for nothing.
    const forced = setTimeout(() => {
      console.error("Shutdown timed out; exiting anyway.");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();

    server.close(async () => {
      try {
        await pool.end();
      } catch (err) {
        console.error("Error closing the pool:", err.message);
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => close("SIGTERM"));
  process.on("SIGINT", () => close("SIGINT"));
}

export async function start() {
  const secretProblem = sessionSecretProblem(process.env.SESSION_SECRET);
  if (secretProblem) {
    console.error(`Refusing to start: ${secretProblem}.`);
    process.exit(1);
  }

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(`Cannot reach the database at ${describeTarget()}: ${describeError(err)}`);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`\n Server running on http://localhost:${PORT}`);
    console.log(`Serving ${describeTarget()}\n`);
  });

  shutdownOn(server);

  return server;
}

export { app };
