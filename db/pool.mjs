// Shared Postgres connection for every db/ script.
//
// Requires DATABASE_URL — the local container during Phases 1-6, the Neon
// connection string only in Phase 7. Never prefix it with VITE_: Vite inlines
// VITE_ variables into the public client bundle.
import "dotenv/config";
import pg from "pg";
import { pinTlsVerification } from "./url.mjs";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. For the local container, use:\n" +
      "  DATABASE_URL=postgres://fanclub:fanclub@localhost:5433/fanclub"
  );
  process.exit(1);
}

// TLS is driven by sslmode in the connection string, never relaxed here. Neon's
// certificates are publicly trusted, so verify-full connects as-is; the local
// container carries no sslmode and connects in the clear.
// pg defaults to ten connections per process, which one small web service in
// front of a free-tier Postgres does not need and a free-tier Postgres would
// rather not hold. Five is generous for sixteen readers, and the idle timeout
// means a service nobody is visiting stops holding connections open against a
// database that also idles.
export const pool = new pg.Pool({
  connectionString: pinTlsVerification(connectionString),
  max: 5,
  idleTimeoutMillis: 30_000,
});

/** Where this connection points, safe to log — no credentials. */
export function describeTarget() {
  const { hostname, port, pathname } = new URL(connectionString);
  return `${hostname}:${port || 5432}${pathname}`;
}
