/**
 * ===============================
 * ADD PLAYOFF WEEKS SCRIPT
 * ===============================
 * 
 * Adds playoff weeks (15, 16, 17) to the season data structure.
 * These weeks include:
 * - Status fields (playoff, toilet, out)
 * - Matchup labels describing the bracket position
 * - Bye teams (represented as "BYE" - no dropdown needed)
 * 
 * USAGE: node add-playoff-weeks.js
 * 
 * This script will backup the existing data before adding playoff weeks.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// CONFIGURATION
// ===============================

const DATA_FILE = path.join(__dirname, "src", "data", "seasons.json");
const BACKUP_DIR = path.join(__dirname, "backups");

/**
 * Playoff week structure based on requirements
 */
const PLAYOFF_WEEKS = {
  15: {
    matchups: [
      {
        team1: null,
        team1Score: null,
        team2: "BYE",
        team2Score: null,
        status: "playoff",
        label: "#1 SEED VS BYE"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "playoff",
        label: "#4 SEED vs #5 SEED"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "playoff",
        label: "#3 SEED vs #6 SEED"
      },
      {
        team1: null,
        team1Score: null,
        team2: "BYE",
        team2Score: null,
        status: "playoff",
        label: "#2 SEED vs BYE"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "toilet",
        label: "#9 SEED vs #12 SEED"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "toilet",
        label: "#10 SEED vs #11 SEED"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "#7 SEED vs #8 SEED"
      }
    ]
  },
  16: {
    matchups: [
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "playoff",
        label: "#1 SEED vs winner #4/#5"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "playoff",
        label: "#2 SEED vs winner #3/#6"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "toilet",
        label: "loser #9/#12 vs loser #10/#11 - Toilet Bowl Champ"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "loser #4/#5 vs loser #3/#6"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "#7 SEED vs winner #10/#11"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "#8 SEED vs winner #9/#12"
      }
    ]
  },
  17: {
    matchups: [
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "playoff",
        label: "Winner Matchup 1 vs Winner Matchup 2 - SUPER BOWL"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "loser Matchup 1 vs loser Matchup 2 - Third Place"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "winner Matchup 3 vs winner Matchup 4"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "winner Matchup 5 vs loser Matchup 6"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "loser Matchup 5 vs winner Matchup 6"
      },
      {
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null,
        status: "out",
        label: "loser Matchup 3 vs loser Matchup 4"
      }
    ]
  }
};

// ===============================
// HELPER FUNCTIONS
// ===============================

/**
 * Create a backup of the data file
 */
function createBackup(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `seasons-before-playoffs-${timestamp}.json`);

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
  }

  fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
  console.log(`✅ Backup created: ${backupFile}`);
  return backupFile;
}

/**
 * Add playoff weeks to a season
 */
function addPlayoffWeeks(season) {
  // Skip if not in the new format (has teams and weeks)
  if (!season.teams || !season.weeks) {
    console.log("   ⏭️  Skipping - not in new format");
    return season;
  }

  // Check if playoff weeks already exist
  if (season.weeks['15'] || season.weeks['16'] || season.weeks['17']) {
    console.log("   ⏭️  Skipping - playoff weeks already exist");
    return season;
  }

  // Add playoff weeks
  season.weeks['15'] = PLAYOFF_WEEKS[15];
  season.weeks['16'] = PLAYOFF_WEEKS[16];
  season.weeks['17'] = PLAYOFF_WEEKS[17];

  console.log("   ✅ Added playoff weeks 15, 16, 17");
  return season;
}

// ===============================
// MAIN EXECUTION
// ===============================

console.log("🏈 ADDING PLAYOFF WEEKS TO SEASONS\n");

// Load data
let seasonsData;
try {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  seasonsData = JSON.parse(raw);
  console.log(`📂 Loaded data from: ${DATA_FILE}`);
  console.log(`   Found ${Object.keys(seasonsData).length} seasons\n`);
} catch (err) {
  console.error("❌ Failed to load seasons.json:", err);
  process.exit(1);
}

// Create backup
createBackup(seasonsData);
console.log();

// Process each season
Object.keys(seasonsData).forEach(year => {
  console.log(`📅 Processing ${year}...`);
  seasonsData[year] = addPlayoffWeeks(seasonsData[year]);
});

// Save updated data
try {
  fs.writeFileSync(DATA_FILE, JSON.stringify(seasonsData, null, 2));
  console.log("\n✅ DONE! Playoff weeks added to all seasons");
  console.log("\n📝 Next steps:");
  console.log("   1. Restart your server");
  console.log("   2. Go to Edit Season page");
  console.log("   3. Assign teams to playoff matchups");
  console.log("   4. Enter scores as playoff games complete\n");
} catch (err) {
  console.error("❌ Failed to save:", err);
  process.exit(1);
}