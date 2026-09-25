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
// pg waits forever for a connection by default, which is not a timeout anyone
// chose. A database that refuses a connection fails in milliseconds; one that
// has gone silent — a blackholed route, a host between here and Neon that drops
// packets rather than answering — never fails at all, so /healthz hangs instead
// of returning its 503 and an outage leaves nothing in the log to search for.
// Ten seconds is long enough for Neon to wake a compute that scaled to zero
// after 5 minutes of idling, and short enough that the monitor is told rather
// than left waiting.
//
// query_timeout is the other half, and it is the half that was actually
// hanging: a connection opened before the network went away is still open, so
// nothing reconnects and nothing fails — the query simply waits on a socket
// nobody is listening to. Measured in 7.11: /healthz hung for 163 seconds and
// wrote no log line at all. A bounded query fails, is logged, and gives the
// client back to the pool instead of holding one of five forever.
export const pool = new pg.Pool({
  connectionString: pinTlsVerification(connectionString),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
});

/** Where this connection points, safe to log — no credentials. */
export function describeTarget() {
  const { hostname, port, pathname } = new URL(connectionString);
  return `${hostname}:${port || 5432}${pathname}`;
}
