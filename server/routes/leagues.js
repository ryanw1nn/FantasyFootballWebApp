// The league-scoped routes, and since Phase 7 the only ones: they speak the
// database's own terms — team ids, playoff_rounds as the rung reached, status
// rather than state, null opponents rather than "BYE". The compatibility aliases
// that spoke src/data/seasons.json's dialect were deleted once the client had
// stopped calling them, and nothing here should learn their quirks back.
//
// Every handler runs the query layer and differs from the next only in how it
// reads and writes the payload — the serializer it hands the bundle to, and the
// row reader it gives the write. Two implementations of "fetch a season" is how
// one dialect becomes two behaviours.
import express from "express";
import {
  allLeagues,
  leagueBySlug,
  loadSeason,
  loadSeasons,
  matchupFromIds,
  pool,
  replaceWeek,
  seasonsOfLeague,
} from "../queries.mjs";
import {
  apiLeague,
  apiLeagues,
  apiSeason,
  apiSeasons,
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

// GET every season of one league, keyed by year. Three queries whatever the
// season count, so a whole league costs the same round trips as one season of
// it — which is what lets a view read a league in a single visit.
router.get("/api/leagues/:slug/seasons", async (req, res) => {
  const league = await leagueBySlug(pool, req.params.slug);
  if (league === null) return res.status(404).json({ error: "League not found" });

  // A league with no seasons is an empty object, not a 404: the league exists.
  const seasons = await seasonsOfLeague(pool, league.slug);
  const bundles = await loadSeasons(pool, seasons);

  res.json({ seasons: apiSeasons(seasons.map((season) => bundles.get(season.id))) });
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

// UPDATE one week. server/guard.mjs has already checked for the unlock.
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
