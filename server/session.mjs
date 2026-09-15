// Session cookies, stored in Postgres.
//
// A session exists only once someone unlocks a league. Readers never get one:
// saveUninitialized is false, so a request that leaves the session untouched
// sets no cookie and writes no row.
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db/pool.mjs";

const PgStore = connectPgSimple(session);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

export const isProduction = process.env.NODE_ENV === "production";

export const SESSION_COOKIE = "ffc.sid";

/** What the cookie is set with, and so what clearing it has to match. */
export const sessionCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
};

/**
 * Why the server must not boot with this secret, or null if it may. There is
 * no fallback: a default would sign every cookie with a string in a public repo.
 */
export function sessionSecretProblem(secret, production = isProduction) {
  if (!secret) return "SESSION_SECRET is not set";
  if (production && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    return `SESSION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`;
  }
  return null;
}

export function sessionMiddleware(secret = process.env.SESSION_SECRET) {
  // start() refuses to listen in this case, so this only keeps express-session
  // from printing its own warning ahead of that message.
  if (!secret) return (req, res, next) => next(new Error("SESSION_SECRET is not set"));

  return session({
    name: SESSION_COOKIE,
    // The shared pool, never a connection string — that would open a second
    // pool with its own TLS settings. The table is migration 004's.
    store: new PgStore({ pool, createTableIfMissing: false }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { ...sessionCookieOptions, maxAge: THIRTY_DAYS_MS },
  });
}
