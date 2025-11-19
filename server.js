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
 * Recalculate season standings from weekly matchup data
 */
function recalculateStandings(year) {
  const season = seasonsData[year];
  if (!season || !season.teams) return;

  // Skip old format seasons (arrays)
  if (Array.isArray(season)) {
    console.log(`⏭️  ${year} - old format, skipping`);
    return;
  }
  
  // Skip seasons without proper weeks structure
  if (!season.weeks || typeof season.weeks !== 'object' || Array.isArray(season.weeks)) {
    console.log(`⏭️  ${year} - no weeks data, skipping`);
    return;
  }

  console.log(`\n Recalculatng ${year}...`);

  // Initialize team stats to zero
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

  // process all weeks, treating null/empty as 0
  let processedGames = 0;
  if (season.weeks) {
    Object.entries(season.weeks).forEach(([weekNum, week]) => {
      if (!week || !week.matchups || !Array.isArray(week.matchups)) return;
      
      week.matchups.forEach(matchup => {
        // get scores - treat null/undefined as 0
        const score1 = parseFloat(matchup.team1Score) || 0;
        const score2 = parseFloat(matchup.team2Score) || 0;

        const name1 = matchup.team1;
        const name2 = matchup.team2;

        // skip if either team doesn't exist in roster
        if (!stats[name1] || !stats[name2]) {
          console.log(`⚠️ Week ${weekNum}: Unknown team "${name1}" or "${name2}"`);
          return;
        }

        // accumulate points
        stats[name1].pf += score1;
        stats[name1].pa += score2;
        stats[name2].pf += score2;
        stats[name2].pa += score1;

        // determine winner and update records
        if (score1 > 0 && score2 > 0) {
          if (score1 > score2) {
            stats[name1].wins++;
            stats[name2].losses++;
            processedGames++;
          } else if (score2 > score1) {
            stats[name2].wins++;
            stats[name1].losses++;
            processedGames++;
          } else {
            // tie game
            stats[name1].ties++;
            stats[name2].ties++;
            processedGames++;
          }
        }
      });
    });
  }

  console.log(`   Processed ${processedGames} completed games`);


  // fallback if no weekly data exists, use end-of-season stats from standings
  if (processedGames === 0 && season.standings) {
    season.standings.forEach(team => {
      if (stats[team.name]) {
        stats[team.name] = {
         wins: team.wins || 0,
         losses: team.losses || 0,
         ties: team.ties || 0,
         pf: team.pf || 0,
         pa: team.pa || 0 
        };
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

  console.log(`✅ Standings updated for ${year}\n`);
}

// ===============================
// ROUTES 
// ===============================

// GET all seasons
app.get("/seasons", (req, res) => {
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

// UNUSED
// // UPDATE a season (replace the whole array)
// app.post("/seasons/:year", (req, res) => {
//   const { year } = req.params;
//   const newData = req.body;
//   if(!Array.isArray(newData)) return res.status(400).json({ error: "Data must be an array" });

//   seasonsData[year] = newData;
//   const result = saveData();

//   if (result.success) {
//     res.json({ success: true, year });
//   } else {
//     res.status(500).json({ error: "Failed to save data" });
//   }
// });

// // UPDATE a single team in a season
// app.patch("/seasons/:year/:team", (req, res) => {
//   const { year, team } = req.params;
//   const updatedTeam = req.body;

//   if (!seasonsData[year]) return res.status(404).json({ error: "Year not found" });

//   const teamIndex = seasonsData[year].findIndex(t => t.team === team);
//   if (teamIndex === -1) return res.status(404).json({ error: "Team not found "});

//   seasonsData[year][teamIndex] = { ...seasonsData[year][teamIndex], ...updatedTeam };
//   const result = saveData();

//   if (result.success) {
//     res.json({ success: true, team });
//   } else {
//     res.status(500).json({ error: "Failed to save data" });
//   }
// });

// /**
//  * GET a specific week's matchups
//  * Returns: {matchups: [...] }
//  */
// app.get("/api/seasons/:year/weeks/:weekNum", (req, res) => {
//   const { year, weekNum } = req.params;
//   const season = seasonsData[year];

//   if (!season) return res.status(404).json({ error: "Season not found "});
//   if (!season.weeks || !season.weeks[weekNum]) {
//     return res.status(404).json({ error: "Week not found" });
//   }

//   res.json(season.weeks[weekNum]);
// });



// UNUSED
// /**
//  * UPDATE a specific week's matchups
//  * Body: { matchups: [...] }
//  */
// app.put("/api/seasons/:year/weeks/:weekNum", (req, res) => {
//   const { year, weekNum } = req.params;
//   const { matchups } = req.body;

//   if (!seasonsData[year]) return res.status(404).json({ error: "Season not found "});
//   if (!Array.isArray(matchups)) return res.status(400).json({ error: "Matchups must be an array" });

//   // Initialize weeks object if it doesn't exist
//   if(!seasonsData[year].weeks) {
//     seasonsData[year].weeks = {};
//   }

//   // Update the week's matchups
//   seasonsData[year].weeks[weekNum] = { matchups };
  
//   // Recalculate standings
//   recalculateStandings(year);

//   const result = saveData();
//   if (result.success) {
//     res.json({success: true, standings: seasonsData[year].standings });
//   } else {
//     res.status(500).json({ error: "Save failed"})
//   }

//   if(result.success) {
//     res.json({
//       success: true,
//       week: weekNum,
//       standings: seasonsData[year].standings
//     });
//   } else {
//     res.status(500).json({ error: "Failed to save data" });
//   }
// });

// /**
//  * CREATE a new week
//  * Body: { matchups: [...] }
//  */
// app.post("/api/seasons/:year/weeks/:weekNum", (req, res) => {
//   const { year, weekNum } = req.params;
//   const { matchups } = req.body;
  
//   if (!seasonsData[year]) return res.status(404).json({ error: "Season not found" });
//   if (!Array.isArray(matchups)) return res.status(400).json({ error: "Matchups must be an array" });

//   if (!seasonsData[year].weeks) {
//     seasonsData[year].weeks = {};
//   }

//   if (seasonsData[year].weeks[weekNum]) {
//     return res.status(409).json({ error: "Week already exists" });
//   }

//   seasonsData[year].weeks[weekNum] = { matchups };
//   recalculateStandings(year);

//   const result = saveData();

//   if (result.success) {
//     res.json({ success: true, week: weekNum });
//   } else {
//     res.status(500).json({ error: "Failed to save data" });
//   }
//});

// ===============================
// TEAM MANAGEMENT ROUTES
// ===============================

// /**
//  * GET all teams for a season
//  */
// app.get("/api/seasons/:year/teams", (req, res) => {
//   const { year } = req.params;
//   const season = seasonsData[year];

//   if (!season) return res.status(404).json({ error: "Season not found" });

//   res.json({ teams: season.teams || [] });
// });

// /**
//  * UPDATE team roster for a season
//  * Body: { teams: [...] }
//  */
// app.put("/api/seasons/:year/teams", (req, res) => {
//   const { year } = req.params;
//   const { teams } = req.body;

//   if (!seasonsData[year]) return res.status(404).json({ error: "Season not found" });
//   if (!Array.isArray(teams)) return res.status(400).json({ error: "Teams must be an array" });

//   seasonsData[year].teams = teams;
//   const result = saveData();

//   if (result.success) {
//     res.json({ success: true, teams });
//   } else {
//     res.status(500).json({ error: "Failed to save data" });
//   }
// });

// /**
//  * GET current standings for a season
//  */
// app.get("/api/seasons/:year/standings", (req, res) => {
//   const { year } = req.params;
//   const season = seasonsData[year];
  
//   if (!season) return res.status(404).json({ error: "Season not found" });
  
//   res.json({ standings: season.standings || season || [] });
// });

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`\n Server running on http://localhost:${PORT}`);
  console.log(`Ready to serve data\n`)
});