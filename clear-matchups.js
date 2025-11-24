/**
 * ===============================
 * CLEAR MATCHUP DATA SCRIPT
 * ===============================
 * 
 * Clears all matchup data from specified years (2023-2024)
 * while preserving team rosters and standings
 * 
 * USAGE: node clear-matchup-data.js
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
const YEARS_TO_CLEAR = ['2023', '2024']; // Years to clear matchup data

/**
 * Number of weeks to create (regular season only)
 * Playoff weeks (15-17) will be added separately if needed
 */
const NUM_REGULAR_WEEKS = 14;

// ===============================
// HELPER FUNCTIONS
// ===============================

/**
 * Create a backup of the data file
 */
function createBackup(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `seasons-before-clear-${timestamp}.json`);

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
  }

  fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
  console.log(`✅ Backup created: ${backupFile}`);
  return backupFile;
}

/**
 * Generate empty matchups for a given number of teams
 */
function generateEmptyWeeks(numTeams, numWeeks) {
  const weeks = {};
  const matchupsPerWeek = Math.floor(numTeams / 2);

  for (let week = 1; week <= numWeeks; week++) {
    const matchups = [];
    
    // Create empty matchup slots
    for (let m = 0; m < matchupsPerWeek; m++) {
      matchups.push({
        team1: null,
        team1Score: null,
        team2: null,
        team2Score: null
      });
    }
    
    weeks[week] = { matchups };
  }

  return weeks;
}

/**
 * Clear matchup data for a season
 */
function clearMatchupData(season, year) {
  // Skip if not in new format
  if (!season.teams || !Array.isArray(season.teams)) {
    console.log(`   ⏭️  Skipping - not in new format`);
    return season;
  }

  const numTeams = season.teams.length;
  const emptyWeeks = generateEmptyWeeks(numTeams, NUM_REGULAR_WEEKS);

  // Replace weeks with empty structure
  season.weeks = emptyWeeks;

  console.log(`   ✅ Cleared ${NUM_REGULAR_WEEKS} weeks of matchup data`);
  console.log(`   📊 Preserved ${numTeams} teams and standings`);
  
  return season;
}

// ===============================
// MAIN EXECUTION
// ===============================

console.log("🧹 CLEARING MATCHUP DATA FROM SPECIFIED YEARS\n");

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

// Process specified years
YEARS_TO_CLEAR.forEach(year => {
  if (!seasonsData[year]) {
    console.log(`⚠️  Year ${year} not found in data, skipping\n`);
    return;
  }

  console.log(`📅 Processing ${year}...`);
  seasonsData[year] = clearMatchupData(seasonsData[year], year);
  console.log();
});

// Save updated data
try {
  fs.writeFileSync(DATA_FILE, JSON.stringify(seasonsData, null, 2));
  console.log("✅ DONE! Matchup data cleared");
  console.log("\n📝 Next steps:");
  console.log(`   1. Restart your server`);
  console.log(`   2. Go to Edit Season page`);
  console.log(`   3. Assign teams and enter scores for ${YEARS_TO_CLEAR.join(', ')}\n`);
} catch (err) {
  console.error("❌ Failed to save:", err);
  process.exit(1);
}