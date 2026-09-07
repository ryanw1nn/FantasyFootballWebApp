// The four routes the client already calls, unchanged in path and payload.
//
// They are hardcoded to the one league and serve the file's dialect through
// server/serialize.mjs. The client is repointed at the league-scoped routes
// later; these are deleted with the constant below when it is.
import express from "express";
import {
  DEFAULT_LEAGUE,
  loadSeason,
  loadSeasons,
  pool,
  replaceWeek,
  seasonsOfLeague,
} from "../queries.mjs";
import { legacySeason, legacySeasons, legacyStandings } from "../serialize.mjs";

export const router = express.Router();

// :year and :weekNum go to the query layer as the strings they arrive as; it
// parses them and throws the 400 before any of them reaches the pool.

// GET all seasons
router.get("/seasons", async (req, res) => {
  const seasons = await seasonsOfLeague(pool, DEFAULT_LEAGUE);
  const bundles = await loadSeasons(pool, seasons);

  res.json(legacySeasons(seasons.map((season) => bundles.get(season.id))));
});

// GET a single season
router.get("/seasons/:year", async (req, res) => {
  const bundle = await loadSeason(pool, DEFAULT_LEAGUE, req.params.year);
  if (bundle === null) return res.status(404).json({ error: "Year not found" });

  res.json(legacySeason(bundle));
});

// GET all weeks for a season
router.get("/api/seasons/:year/weeks", async (req, res) => {
  const bundle = await loadSeason(pool, DEFAULT_LEAGUE, req.params.year);
  if (bundle === null) return res.status(404).json({ error: "Season not found" });

  const season = legacySeason(bundle);
  res.json({ weeks: season.weeks, teams: season.teams });
});

// UPDATE week
router.put("/api/seasons/:year/weeks/:weekNum", async (req, res) => {
  const { matchups } = req.body ?? {};

  if (!Array.isArray(matchups)) return res.status(400).json({ error: "Invalid data" });

  const bundle = await replaceWeek(
    DEFAULT_LEAGUE,
    req.params.year,
    req.params.weekNum,
    matchups
  );
  res.json({ success: true, standings: legacyStandings(bundle) });
});
