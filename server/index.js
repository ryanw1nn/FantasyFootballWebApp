// App wiring and listen.
//
// The data comes from Postgres — there is no in-memory copy of a season and no
// file on disk to fall back to, so the process refuses to start without a
// reachable database rather than serving 500s on every request.
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
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

app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
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

  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

// An idle client dropped by the server must not take the process down with it.
pool.on("error", (err) => {
  console.error("Idle database client error:", err.message);
});

const PORT = process.env.PORT || 5001;

export async function start() {
  const secretProblem = sessionSecretProblem(process.env.SESSION_SECRET);
  if (secretProblem) {
    console.error(`Refusing to start: ${secretProblem}.`);
    process.exit(1);
  }

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    // A refused connection arrives as an AggregateError with an empty message,
    // one entry per address the host resolved to.
    const detail = err.message || err.errors?.map((e) => e.message).join("; ") || err.code;
    console.error(`Cannot reach the database at ${describeTarget()}: ${detail}`);
    process.exit(1);
  }

  return app.listen(PORT, () => {
    console.log(`\n Server running on http://localhost:${PORT}`);
    console.log(`Serving ${describeTarget()}\n`);
  });
}

export { app };
