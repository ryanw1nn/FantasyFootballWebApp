// Unlocking a league for writes, locking it again, and asking which it is.
//
// A session records the ids of the leagues it may write to in canWrite. Ids,
// not slugs: if a slug were ever reused, the access it granted stays with the
// league it was granted for.
//
// Only unlock ever writes to req.session. Status reads it and lock empties it,
// so a reader who never unlocks never gets a cookie or a session row.
import express from "express";
import { rateLimit } from "express-rate-limit";
import { leagueBySlug, leagueSecretBySlug, pool } from "../queries.mjs";
import { verifyPassphrase } from "../passphrase.mjs";
import { SESSION_COOKIE, sessionCookieOptions } from "../session.mjs";
import { parseUnlockBody } from "../validate.mjs";

export const router = express.Router();

/** Brute force is the only realistic attack on a single passphrase. */
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// UNLOCK a league for this session
router.post("/api/leagues/:slug/unlock", unlockLimiter, async (req, res) => {
  const passphrase = parseUnlockBody(req.body);

  const league = await leagueSecretBySlug(pool, req.params.slug);
  if (league === null) return res.status(404).json({ error: "League not found" });

  // A league with no hash verifies against a dummy and fails, in the same time.
  const matches = await verifyPassphrase(passphrase, league.write_secret_hash);
  if (!matches) return res.status(401).json({ error: "Incorrect passphrase" });

  // A new session id on every unlock, so an id planted before it is worthless.
  // Leagues this session had already unlocked come across to the new one.
  const unlocked = new Set(unlockedLeagues(req.session));
  unlocked.add(league.id);

  await regenerate(req.session);
  req.session.canWrite = [...unlocked];

  res.json({ canWrite: true });
});

// LOCK a league for this session
router.post("/api/leagues/:slug/lock", async (req, res) => {
  const league = await leagueBySlug(pool, req.params.slug);
  if (league === null) return res.status(404).json({ error: "League not found" });

  const unlocked = unlockedLeagues(req.session);
  const remaining = unlocked.filter((id) => id !== league.id);

  if (remaining.length > 0) {
    req.session.canWrite = remaining;
  } else if (unlocked.length > 0) {
    // Nothing left to remember: drop the row and tell the browser to forget it.
    await destroy(req.session);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  }

  res.status(204).end();
});

// GET whether this session may write to the league
router.get("/api/leagues/:slug/session", async (req, res) => {
  const league = await leagueBySlug(pool, req.params.slug);
  if (league === null) return res.status(404).json({ error: "League not found" });

  res.json({ canWrite: unlockedLeagues(req.session).includes(league.id) });
});

/** The league ids a session may write to; empty when there is no session. */
function unlockedLeagues(session) {
  return Array.isArray(session?.canWrite) ? session.canWrite : [];
}

function regenerate(session) {
  return new Promise((resolve, reject) => {
    session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function destroy(session) {
  return new Promise((resolve, reject) => {
    session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
