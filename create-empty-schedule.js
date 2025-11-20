/**
 * CREATE EMPTY SCHEDULE
 * 
 * Generates empty weeks for a season with no pre-filled matchups
 * User can then manually assign teams and enter scores
 * 
 * USAGE: node create-empty-schedule.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "src", "data", "seasons.json");
const BACKUP_FILE = path.join(__dirname, "src", "data", "seasons-before-clean.json");

console.log("🧹 CREATING CLEAN EMPTY SCHEDULE...\n");

// Configuration
const SEASON_YEAR = '2025';  // Change this to the season you want to create
const NUM_WEEKS = 14;        // Number of regular season weeks
const TEAMS_COUNT = 12;      // Number of teams in league

// Load data
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log("✅ Loaded seasons.json");
} catch (err) {
  console.error("❌ Failed to load:", err);
  process.exit(1);
}

// Create backup
try {
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
  console.log("✅ Backup created: seasons-before-clean.json\n");
} catch (err) {
  console.error("❌ Backup failed:", err);
  process.exit(1);
}

// Get the season
const season = data[SEASON_YEAR];

if (!season || !season.teams) {
  console.error(`❌ Season ${SEASON_YEAR} not found or has no teams`);
  process.exit(1);
}

console.log(`📅 Processing ${SEASON_YEAR}...`);
console.log(`   👥 ${season.teams.length} teams found`);

// Calculate matchups per week (half the number of teams)
const matchupsPerWeek = Math.floor(TEAMS_COUNT / 2);

// Create empty weeks
const emptyWeeks = {};
for (let week = 1; week <= NUM_WEEKS; week++) {
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
  
  emptyWeeks[week] = { matchups };
}

// Replace the weeks
season.weeks = emptyWeeks;

console.log(`   ✅ Created ${NUM_WEEKS} empty weeks with ${matchupsPerWeek} matchups each`);

// Save
try {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log("\n✅ DONE! Empty schedule created");
  console.log("\n📝 Next steps:");
  console.log("   1. Restart your server");
  console.log("   2. Go to Edit Season page");
  console.log("   3. Assign teams to matchups");
  console.log("   4. Enter scores as games complete\n");
} catch (err) {
  console.error("❌ Save failed:", err);
  process.exit(1);
}