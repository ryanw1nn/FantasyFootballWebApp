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
// PORT MANAGEMENT
// ===============================
const DEFAULT_PORT = 5001;
const FALLBACK_PORT = 5000;

/**
 * Find an available port, trying DEFAULT_PORT first, then FALLBACK_PORT
 */
async function findAvailablePort() {
  const net = await import('net');

  return new Promise((resolve) => {
    const server = net.createServer();

    server.listen(DEFAULT_PORT, () => {
      server.close(() => resolve(DEFAULT_PORT));
    });

    server.on('error', () => {
      // Port 5000 in use, try fallback
      const fallbackServer = net.createServer();

      fallbackServer.listen(FALLBACK_PORT, () => {
        fallbackServer.close(() => resolve(FALLBACK_PORT));
      });

      fallbackServer.on('error', () => {
        console.error('❌ Both ports 5000 and 5001 are in use!');
        console.error('Kill the process: lsof -ti:5000 | xargs kill -9');
        process.exit(1);
      });
    });
  });
}



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
 * Recalculate season standings from weekly matchup data
 */
function recalculateStandings(year) {
  const season = seasonsData[year];
  if (!season) return;

  // Initialize team stats
  const stats = {};
  season.teams.forEach(team => {
    stats[team.name] = {
      wins: 0,
      losses: 0,
      ties: 0,
      pf: 0,
      pa: 0
    };
  });

  // check if we have weekly matchup data
  let hasWeeklyData = false;

  if (season.weeks && Object.keys(season.weeks).length > 0) {
    // Aggregate from weekly matchups
    Object.values(season.weeks).forEach(week => {
      week.matchups.forEach(matchup => {
        const score1 = parseFloat(matchup.team1Score);
        const score2 = parseFloat(matchup.team2Score);

        // Check if we have ANY non=zero scores (null, 0, NaN treated as no data)
        const hasValidScore1 = !isNaN(score1) && score1 !== null && score1 > 0;
        const hasValidScore2 = !isNaN(score2) && score2 !== null && score2 > 0;

        // if either score is non-zero, we have weekly data
        if (hasValidScore1 || hasValidScore2) {
          hasWeeklyData = true;

          const team1 = matchup.team1;
          const team2 = matchup.team2;
          const s1 = hasValidScore1 ? score1 : 0;
          const s2 = hasValidScore2 ? score2 : 0;
      
          if (stats[team1] && stats[team2]) {
            // accumulate points
            stats[team1].pf += s1;
            stats[team1].pa += s2;
            stats[team2].pf += s2;
            stats[team2].pa += s1;

            // determine winner and update records
            if (hasValidScore1 && hasValidScore2) {
              if (s1 > s2) {
                stats[team1].wins++;
                stats[team2].losses++;
              } else if (s2 > s1) {
                stats[team2].wins++;
                stats[team1].losses++;
              } else {
                // tie game
                stats[team1].ties++;
                stats[team2].ties++;
              }
            }
          }
        }
      });
    });
  }

  // fallback if no weekly data exists, use end-of-season stats from standings
  if (!hasWeeklyData && season.standings && Array.isArray(season.standings)) {
    season.standings.forEach(team => {
      if (stats[team.name]) {
        stats[team.name].wins = team.wins || 0;
        stats[team.name].losses = team.losses || 0;
        stats[team.name].ties = team.ties || 0;
        stats[team.name].pf = team.pf || 0;
        stats[team.name].pa = team.pa || 0;
      }
    });
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
      pa: stats[team.name].pa
    };
  });

  // Sort by wins (descending), then by PF (descending)
  season.standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pf - a.pf
  });

  // Assign places based on sorted order
  season.standings.forEach((team, idx) => {
    team.place = idx + 1;
  });
}

// ===============================
// ROUTES 
// ===============================

// GET all seasons
app.get("/seasons", (req, res) => {
  res.json(seasonsData);
});

// GET a single season
app.get("/seasons/:year", (req, res) => {
  const { year } = req.params;
  if (!seasonsData[year]) return res.status(404).json({ error: "Year not found"});
  res.json(seasonsData[year]);
});

// UPDATE a season (replace the whole array)
app.post("/seasons/:year", (req, res) => {
  const { year } = req.params;
  const newData = req.body;
  if(!Array.isArray(newData)) return res.status(400).json({ error: "Data must be an array" });

  seasonsData[year] = newData;
  const result = saveData();

  if (result.success) {
    res.json({ success: true, year });
  } else {
    res.status(500).json({ error: "Failed to save data" });
  }
});

// UPDATE a single team in a season
app.patch("/seasons/:year/:team", (req, res) => {
  const { year, team } = req.params;
  const updatedTeam = req.body;

  if (!seasonsData[year]) return res.status(404).json({ error: "Year not found" });

  const teamIndex = seasonsData[year].findIndex(t => t.team === team);
  if (teamIndex === -1) return res.status(404).json({ error: "Team not found "});

  seasonsData[year][teamIndex] = { ...seasonsData[year][teamIndex], ...updatedTeam };
  const result = saveData();

  if (result.success) {
    res.json({ success: true, team });
  } else {
    res.status(500).json({ error: "Failed to save data" });
  }
});

/**
 * GET all weeks for a season
 * Returns: { weeks: { "1": {...}, "2": {...} } }
 */
app.get("/api/seasons/:year/weeks", (req, res) => {
  const { year } = req.params;
  const season = seasonsData[year];

  if (!season) return res.status(404).json({ error: "Season ont found" });

  res.json({
    weeks: season.weeks || {},
    teams: season.teams || []
  });
});

/**
 * GET a specific week's matchups
 * Returns: {matchups: [...] }
 */
app.get("/api/seasons/:year/weeks/:weekNum", (req, res) => {
  const { year, weekNum } = req.params;
  const season = seasonsData[year];

  if (!season) return res.status(404).json({ error: "Season not found "});
  if (!season.weeks || !season.weeks[weekNum]) {
    return res.status(404).json({ error: "Week not found" });
  }

  res.json(season.weeks[weekNum]);
});

/**
 * UPDATE a specific week's matchups
 * Body: { matchups: [...] }
 */
app.put("/api/seasons/:year/weeks/:weekNum", (req, res) => {
  const { year, weekNum } = req.params;
  const { matchups } = req.body;

  if (!seasonsData[year]) return res.status(404).json({ error: "Season not found "});
  if (!Array.isArray(matchups)) return res.status(400).json({ error: "Matchups must be an array" });

  // Initialize weeks object if it doesn't exist
  if(!seasonsData[year].weeks) {
    seasonsData[year].weeks = {};
  }

  // Update the week's matchups
  seasonsData[year].weeks[weekNum] = { matchups };
  
  // Recalculate standings
  recalculateStandings(year);

  const result = saveData();

  if(result.success) {
    res.json({
      success: true,
      week: weekNum,
      standings: seasonsData[year].standings
    });
  } else {
    res.status(500).json({ error: "Failed to save data" });
  }
});

/**
 * CREATE a new week
 * Body: { matchups: [...] }
 */
app.post("/api/seasons/:year/weeks/:weekNum", (req, res) => {
  const { year, weekNum } = req.params;
  const { matchups } = req.body;
  
  if (!seasonsData[year]) return res.status(404).json({ error: "Season not found" });
  if (!Array.isArray(matchups)) return res.status(400).json({ error: "Matchups must be an array" });

  if (!seasonsData[year].weeks) {
    seasonsData[year].weeks = {};
  }

  if (seasonsData[year].weeks[weekNum]) {
    return res.status(409).json({ error: "Week already exists" });
  }

  seasonsData[year].weeks[weekNum] = { matchups };
  recalculateStandings(year);

  const result = saveData();

  if (result.success) {
    res.json({ success: true, week: weekNum });
  } else {
    res.status(500).json({ error: "Failed to save data" });
  }
});

// ===============================
// TEAM MANAGEMENT ROUTES
// ===============================

/**
 * GET all teams for a season
 */
app.get("/api/seasons/:year/teams", (req, res) => {
  const { year } = req.params;
  const season = seasonsData[year];

  if (!season) return res.status(404).json({ error: "Season not found" });

  res.json({ teams: season.teams || [] });
});

/**
 * UPDATE team roster for a season
 * Body: { teams: [...] }
 */
app.put("/api/seasons/:year/teams", (req, res) => {
  const { year } = req.params;
  const { teams } = req.body;

  if (!seasonsData[year]) return res.status(404).json({ error: "Season not found" });
  if (!Array.isArray(teams)) return res.status(400).json({ error: "Teams must be an array" });

  seasonsData[year].teams = teams;
  const result = saveData();

  if (result.success) {
    res.json({ success: true, teams });
  } else {
    res.status(500).json({ error: "Failed to save data" });
  }
});

/**
 * GET current standings for a season
 */
app.get("/api/seasons/:year/standings", (req, res) => {
  const { year } = req.params;
  const season = seasonsData[year];
  
  if (!season) return res.status(404).json({ error: "Season not found" });
  
  res.json({ standings: season.standings || season || [] });
});

// ===============================
// START SERVER
// ===============================

(async () => {
  const PORT = await findAvailablePort();

  const server = app.listen(PORT, () => {
    console.log(`Backend is running at http://localhost:${PORT}`);
    console.log(`Server is ready to accept requests...`)
    console.log(`Press Ctrl+C to stop the server`);
  });

  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
  });
})();