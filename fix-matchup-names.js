/**
 * FIX MATCHUP NAMES
 * 
 * This script converts matchups from using team names to player names
 * So the system can properly calculate standings
 * 
 * USAGE: node fix-matchup-names.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "src", "data", "seasons.json");
const BACKUP_FILE = path.join(__dirname, "src", "data", "seasons-backup.json");

console.log("🔧 FIXING MATCHUP NAMES...\n");

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
  console.log("✅ Backup created: seasons-backup.json\n");
} catch (err) {
  console.error("❌ Backup failed:", err);
  process.exit(1);
}

// Fix each season
Object.entries(data).forEach(([year, season]) => {
  console.log(`\n📅 Processing ${year}...`);
  
  // Skip if old array format
  if (Array.isArray(season)) {
    console.log("   ⏭️  Old format - skipping");
    return;
  }

  if (!season.teams || !season.weeks) {
    console.log("   ⏭️  No weeks - skipping");
    return;
  }

  // Build map: team abbreviation -> player name
  const teamToName = {};
  season.teams.forEach(team => {
    teamToName[team.team] = team.name;
  });

  console.log(`   👥 Found ${season.teams.length} teams`);
  
  // Fix each week's matchups
  let fixedCount = 0;
  Object.entries(season.weeks).forEach(([weekNum, week]) => {
    week.matchups.forEach(matchup => {
      // Convert team names to player names
      if (teamToName[matchup.team1]) {
        matchup.team1 = teamToName[matchup.team1];
        fixedCount++;
      }
      if (teamToName[matchup.team2]) {
        matchup.team2 = teamToName[matchup.team2];
        fixedCount++;
      }
    });
  });

  console.log(`   ✅ Fixed ${fixedCount} matchup references`);
});

// Save fixed data
try {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log("\n✅ DONE! Data saved to seasons.json");
  console.log("\n📝 Next steps:");
  console.log("   1. Restart your server");
  console.log("   2. Refresh your browser");
  console.log("   3. Check if standings calculate correctly\n");
} catch (err) {
  console.error("❌ Save failed:", err);
  process.exit(1);
}