/**
 * ===============================
 * ADD PLAYOFF WEEKS (SAFE MODE)
 * ===============================
 * 
 * Adds playoff weeks (15, 16, 17) to specified years
 * WITHOUT modifying any existing data
 * 
 * USAGE: node add-playoff-weeks-safe.js
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
 * Years to add playoff weeks to
 * Change this array to target different years
 */
const YEARS_TO_UPDATE = ['2023', '2024'];

/**
 * Playoff week structure
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
  const backupFile = path.join(BACKUP_DIR, `seasons-before-playoff-add-${timestamp}.json`);

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
  }

  fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
  console.log(`✅ Backup created: ${backupFile}`);
  return backupFile;
}

/**
 * Safely add playoff weeks to a season
 * Only adds weeks that don't already exist
 */
function addPlayoffWeeksToSeason(season, year) {
  // Verify season has proper structure
  if (!season.teams || !season.weeks) {
    console.log(`   ⚠️  Skipping - season not in correct format`);
    return { modified: false, reason: 'invalid_format' };
  }

  let addedWeeks = [];
  let skippedWeeks = [];

  // Check each playoff week
  [15, 16, 17].forEach(weekNum => {
    const weekKey = weekNum.toString();
    
    if (season.weeks[weekKey]) {
      // Week already exists, don't modify it
      skippedWeeks.push(weekNum);
    } else {
      // Week doesn't exist, add it
      season.weeks[weekKey] = PLAYOFF_WEEKS[weekNum];
      addedWeeks.push(weekNum);
    }
  });

  // Report results
  if (addedWeeks.length > 0) {
    console.log(`   ✅ Added weeks: ${addedWeeks.join(', ')}`);
  }
  if (skippedWeeks.length > 0) {
    console.log(`   ⏭️  Skipped existing weeks: ${skippedWeeks.join(', ')}`);
  }

  return { 
    modified: addedWeeks.length > 0, 
    addedWeeks,
    skippedWeeks 
  };
}

// ===============================
// MAIN EXECUTION
// ===============================

console.log("🏈 ADDING PLAYOFF WEEKS (SAFE MODE)\n");
console.log(`📋 Target years: ${YEARS_TO_UPDATE.join(', ')}`);
console.log(`📊 Will add weeks: 15, 16, 17 (if they don't exist)\n`);

// Load data
let seasonsData;
try {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  seasonsData = JSON.parse(raw);
  console.log(`📂 Loaded data from: ${DATA_FILE}`);
  console.log(`   Found ${Object.keys(seasonsData).length} total seasons\n`);
} catch (err) {
  console.error("❌ Failed to load seasons.json:", err);
  process.exit(1);
}

// Create backup
createBackup(seasonsData);
console.log();

// Track changes
let totalModified = 0;
let totalAdded = 0;

// Process each target year
YEARS_TO_UPDATE.forEach(year => {
  console.log(`📅 Processing ${year}...`);
  
  if (!seasonsData[year]) {
    console.log(`   ⚠️  Year not found in data, skipping\n`);
    return;
  }

  const result = addPlayoffWeeksToSeason(seasonsData[year], year);
  
  if (result.modified) {
    totalModified++;
    totalAdded += result.addedWeeks.length;
  } else if (result.reason === 'invalid_format') {
    console.log(`   ❌ Season has invalid format\n`);
  } else {
    console.log(`   ℹ️  All playoff weeks already exist\n`);
  }
  
  console.log();
});

// Save only if changes were made
if (totalModified > 0) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seasonsData, null, 2));
    console.log("✅ DONE! Changes saved");
    console.log(`\n📊 Summary:`);
    console.log(`   ${totalModified} year(s) modified`);
    console.log(`   ${totalAdded} playoff week(s) added`);
    console.log("\n📝 Next steps:");
    console.log("   1. Restart your server");
    console.log("   2. Go to Edit Season page");
    console.log("   3. Navigate to weeks 15-17 to see playoff structure\n");
  } catch (err) {
    console.error("❌ Failed to save:", err);
    process.exit(1);
  }
} else {
  console.log("ℹ️  No changes needed - all playoff weeks already exist");
  console.log("   Your data remains unchanged\n");
}