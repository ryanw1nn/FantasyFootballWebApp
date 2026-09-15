// App wiring and listen.
//
// The data comes from Postgres — there is no in-memory copy of a season and no
// file on disk to fall back to, so the process refuses to start without a
// reachable database rather than serving 500s on every request.
import express from "express";
import cors from "cors";
import { pool } from "./queries.mjs";
import { describeTarget } from "../db/pool.mjs";
import { router as legacyRoutes } from "./routes/legacy.js";
import { router as leagueRoutes } from "./routes/leagues.js";
import { isProduction, sessionMiddleware, sessionSecretProblem } from "./session.mjs";

const app = express();

// Render terminates TLS and forwards plain HTTP. Trusting X-Forwarded-* there
// lets Express see https and issue the secure cookie; trusting it locally would
// let any client pick its own IP for the unlock rate limiter.
if (isProduction) app.set("trust proxy", 1);

app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(sessionMiddleware());
app.use(express.json({ limit: "100kb" }));

app.use(leagueRoutes);
app.use(legacyRoutes);

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
