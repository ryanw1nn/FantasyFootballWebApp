// ===============================
// IMPORTS & SETUP
// ===============================
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ===============================
// MIDDLEWARE
// ===============================
app.use(cors({ 
  origin: "http://localhost:5173", // Vite dev server
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})); 
app.use(express.json()); // Parse JSON request bodies

// ===============================
// DATA FILE PATHS
// ===============================
const dataFile = path.join(__dirname, "src", "data", "seasons.json");
const backupDir = path.join(__dirname, "backups");

// Create backup directory if it doesn't exist
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

// ===============================
// LOAD DATA INTO MEMORY
// ===============================
let seasonsData = {};
try {
  const raw = fs.readFileSync(dataFile, "utf-8");
  seasonsData = JSON.parse(raw);
  console.log("Seasons data loaded. Years:", Object.keys(seasonsData));
} catch (err) {
  console.error("Could not load seasons.json:", err);
  process.exit(1); // Exit if data can't be loaded
}


// ===============================
// HELPER FUNCTIONS
// ===============================

/**
 * Save data to JSON file
 */
function saveData() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(seasonsData, null, 2));
    return { success: true };
  } catch (err) {
    console.error("Error writing file:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Reload data from JSON file
 * picks up manual edits to the JSON file
 */
function reloadData() {
  try {
    const raw = fs.readFileSync(dataFile, "utf-8");
    seasonsData = JSON.parse(raw);
    return { success: true };
  } catch (err) {
    console.error("Error reading file:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Recalculate season standings from weekly matchup data
 */
function recalculateStandings(year) {
  const season = seasonsData[year];
  if (!season || !season.teams) return;

  // Skip old format seasons (arrays)
  if (Array.isArray(season)) {
    return;
  }
  
  // Skip seasons without proper weeks structure
  if (!season.weeks || typeof season.weeks !== 'object' || Array.isArray(season.weeks)) {
    return;
  }

  // Initialize team stats to zero
  const stats = {};
  season.teams.forEach(team => {
    stats[team.name] = {
      wins: 0,
      losses: 0,
      ties: 0,
      pf: 0,
      pa: 0,
      // playoff stats by status
      playoffStats: {
        playoff: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0},
        toilet: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0},
        out: { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0}
      }
    };
  });

  // find weeks that have actual scores
  const weeksWithScores = Object.keys(season.weeks)
    .map(Number)
    .filter(n => !isNaN(n))
    .filter(weekNum => {
      const w = season.weeks[weekNum];
      if (!w || !w.matchups) return false;
      return w.matchups.some(m =>
        m.team1Score !== null && m.team2Score !== null &&
        m.team1Score > 0 && m.team2Score > 0  
      );
    })
    .sort((a, b) => a - b);

  let prevWeekPlaces = {}; // stores places after second-to-last week

  // process weeks in order
  for (let i = 0; i < weeksWithScores.length; i++) {
    const weekNum = weeksWithScores[i];
    const weekData = season.weeks[weekNum];

    if (!weekData || !weekData.matchups) continue;
  
    // determine if this is a playoff week (15+)
    const isPlayoffWeek = weekNum >= 15;

    // process this week's matchups
    weekData.matchups.forEach(matchup => {
      // get scores - treat null/undefined as 0
      const score1 = parseFloat(matchup.team1Score) || 0;
      const score2 = parseFloat(matchup.team2Score) || 0;

      const name1 = matchup.team1;
      const name2 = matchup.team2;

      // skip if either team doesn't exist in roster or is BYE
      if (!stats[name1] || !stats[name2] || name1 === 'BYE' || 'name2' === 'BYE') return;
      
      let statBucket1, statBucket2;

      if(!isPlayoffWeek) {
        // regular week - use main stats
        statBucket1 = stats[name1];
        statBucket2 = stats[name2];
      } else {
        // playoff week - use status-specific bucket
        const status = matchup.status || 'out'; //defaults to out
        statBucket1 = stats[name1].playoffStats[status];
        statBucket2 = stats[name2].playoffStats[status];
      }

      // accumulate points
      statBucket1.pf += score1;
      statBucket1.pa += score2;
      statBucket2.pf += score2;
      statBucket2.pa += score1;

      // determine winner and update records
      if (score1 > 0 && score2 > 0) {
        if (score1 > score2) {
          statBucket1.wins++;
          statBucket2.losses++;
        } else if (score2 > score1) {
          statBucket2.wins++;
          statBucket1.losses++;
        } else {
          // tie game
          statBucket1.ties++;
          statBucket2.ties++;
        }
      }
    });

    // tracks place after second-to-last REGULAR season week (before playoff start)
    // only consider regular season weeks for this calculation
    if (!isPlayoffWeek) {
      const regularSeasonWeeks = weeksWithScores.filter(w => w < 15);
      const currentRegularWeekIndex = regularSeasonWeeks.indexOf(weekNum);

      if (currentRegularWeekIndex === regularSeasonWeeks.length - 2) {
        const currentStandings = season.teams.map(team => ({
          name: team.name,
          wins: stats[team.name].wins,
          pf: stats[team.name].pf
        }));

        currentStandings.sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.pf - a.pf;
        });

        currentStandings.forEach((team, idx) => {
          prevWeekPlaces[team.name] = idx + 1;
        });
      }
    }
  }

  if (weeksWithScores.length === 0) {
    return;
  } 

  // Update standings array with calculated stats
  season.standings = season.teams.map(team => {
    // Preserve existing metadata (playoff info, championships, etc.)
    const existingTeam = season.standings?.find(t => t.name === team.name) || {};

    return {
      ...team,
      ...existingTeam,
      wins: stats[team.name].wins,
      losses: stats[team.name].losses,
      ties: stats[team.name].ties,
      pf: stats[team.name].pf,
      pa: stats[team.name].pa,
      playoffStats: stats[team.name].playoffStats
    };
  });

  // Sort by wins (descending), then by PF (descending)
  season.standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pf - a.pf
  });

  // Assign places based on sorted order
  season.standings.forEach((team, idx) => {
    const currentPlace = idx + 1;
    const previousPlace = prevWeekPlaces[team.name] || currentPlace;

    team.place = currentPlace;
    team.prevPlace = previousPlace;
  });
}

// ===============================
// ROUTES 
// ===============================

// GET all seasons
app.get("/seasons", (req, res) => {
  // reload data from disk to pick up any manual JSON edits
  reloadData();

  Object.keys(seasonsData).forEach(year => recalculateStandings(year));
  res.json(seasonsData);
});

// GET a single season
app.get("/seasons/:year", (req, res) => {
  const { year } = req.params;
  if (!seasonsData[year]) return res.status(404).json({ error: "Year not found"});
  recalculateStandings(year);
  res.json(seasonsData[year]);
});

/**
 * GET all weeks for a season
 * Returns: { weeks: { "1": {...}, "2": {...} } }
 */
app.get("/api/seasons/:year/weeks", (req, res) => {
  const { year } = req.params;
  const season = seasonsData[year];
  if (!season) return res.status(404).json({ error: "Season not found" });
  res.json({
    weeks: season.weeks || {},
    teams: season.teams || []
  });
});

// UPDATE week
app.put("/api/seasons/:year/weeks/:weekNum", (req, res) => {
  const {year, weekNum } = req.params;
  const {matchups} = req.body;

  if (!seasonsData[year]) return res.status(404).json({ error: "Not found" });
  if (!Array.isArray(matchups)) return res.status(400).json({ error: "Invalid data" });

  if (!seasonsData[year].weeks) seasonsData[year].weeks = {};
  
  seasonsData[year].weeks[weekNum] = { matchups };
  recalculateStandings(year);
  
  const result = saveData();
  if (result.success) {
    res.json({ success: true, standings: seasonsData[year].standings });
  } else {
    res.status(500).json({ error: "Save failed" });
  }
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`\n Server running on http://localhost:${PORT}`);
  console.log(`Ready to serve data\n`)
});