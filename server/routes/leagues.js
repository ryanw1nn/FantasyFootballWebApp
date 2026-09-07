// The league-scoped routes, which speak the database's own terms — team ids,
// playoff_rounds as the rung reached, status rather than state, null opponents
// rather than "BYE". Nothing consumes them yet, and they must never learn the
// file's quirks: that is what server/routes/legacy.js is for.
//
// Every handler here runs the same query layer as its alias in legacy.js and
// differs only in how it reads and writes the payload — the serializer it hands
// the bundle to, and the row reader it gives the write. Two implementations of
// "fetch a season" is how two dialects drift into two behaviours.
import express from "express";
import {
  allLeagues,
  leagueBySlug,
  loadSeason,
  matchupFromIds,
  pool,
  replaceWeek,
  seasonsOfLeague,
} from "../queries.mjs";
import {
  apiLeague,
  apiLeagues,
  apiSeason,
  apiStandings,
  apiWeeks,
} from "../serialize-api.mjs";

export const router = express.Router();

// :slug, :year and :week go to the query layer as the strings they arrive as;
// it parses them and throws the 400 before any of them reaches the pool.

// GET every league
router.get("/api/leagues", async (req, res) => {
  res.json({ leagues: apiLeagues(await allLeagues(pool)) });
});

// GET one league and the shape of each of its seasons
router.get("/api/leagues/:slug", async (req, res) => {
  const league = await leagueBySlug(pool, req.params.slug);
  if (league === null) return res.status(404).json({ error: "League not found" });

  const seasons = await seasonsOfLeague(pool, league.slug);
  res.json(apiLeague(league, seasons));
});

// GET one season — teams, standings and weeks
router.get("/api/leagues/:slug/seasons/:year", async (req, res) => {
  const bundle = await loadLeagueSeason(req, res);
  if (bundle === null) return;

  res.json(apiSeason(bundle));
});

// GET one season's weeks, which is all the edit page needs
router.get("/api/leagues/:slug/seasons/:year/weeks", async (req, res) => {
  const bundle = await loadLeagueSeason(req, res);
  if (bundle === null) return;

  res.json({ weeks: apiWeeks(bundle) });
});

// UPDATE one week. Still unauthenticated — see Phase 3.
router.put("/api/leagues/:slug/seasons/:year/weeks/:week", async (req, res) => {
  const { matchups } = req.body ?? {};

  const bundle = await replaceWeek(
    req.params.slug,
    req.params.year,
    req.params.week,
    matchups,
    matchupFromIds
  );
  res.json({ standings: apiStandings(bundle) });
});

/**
 * The season both read routes want, or null once a 404 has been answered. An
 * unknown slug and an unknown year are separate mistakes and say so.
 */
async function loadLeagueSeason(req, res) {
  const league = await leagueBySlug(pool, req.params.slug);
  if (league === null) {
    res.status(404).json({ error: "League not found" });
    return null;
  }

  const bundle = await loadSeason(pool, league.slug, req.params.year);
  if (bundle === null) {
    res.status(404).json({ error: "Season not found" });
    return null;
  }

  return bundle;
}
