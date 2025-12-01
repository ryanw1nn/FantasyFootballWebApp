/**
 * ===============================
 * CLEAR TEAMS SCRIPT
 * ===============================
 * 
 * This script clears the team names from matchups in the seasons.json file
 * for specific years (2020, 2021, 2022), making it easier for manual data entry.
 * 
 * WHAT IT DOES:
 * - Sets all team1 and team2 fields to null for specified years
 * - Keeps scores as null
 * - Preserves the matchup structure
 * - Creates a backup before making changes
 * 
 * USAGE:
 *   node clear-teams.js
 * 
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// CONFIGURATION
// ===============================

const DATA_FILE = path.join(__dirname, "src", "data", "seasons.json");
const BACKUP_DIR = path.join(__dirname, "backups");

// Years to clear
const YEARS_TO_CLEAR = ['2020', '2021', '2022'];

// ===============================
// MAIN FUNCTION
// ===============================

function clearTeams() {
  console.log("🧹 CLEARING TEAMS FROM MATCHUPS...\n");

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
    console.log("📁 Created backup directory");
  }

  // Load seasons data
  let data;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    data = JSON.parse(raw);
    console.log("✅ Loaded seasons.json\n");
  } catch (err) {
    console.error("❌ Failed to load seasons.json:", err);
    process.exit(1);
  }

  // Create backup
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `seasons-before-clear-${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
    console.log(`💾 Backup created: ${path.basename(backupFile)}\n`);
  } catch (err) {
    console.error("❌ Backup failed:", err);
    process.exit(1);
  }

  // Process each year
  let totalCleared = 0;
  YEARS_TO_CLEAR.forEach(year => {
    if (!data[year]) {
      console.log(`⏭️  ${year} - Season not found, skipping`);
      return;
    }

    const season = data[year];
    
    // Check if season has the expected structure
    if (!season.weeks || typeof season.weeks !== 'object') {
      console.log(`⏭️  ${year} - No weeks structure found, skipping`);
      return;
    }

    // Count matchups cleared for this year
    let yearCleared = 0;

    // Iterate through all weeks
    Object.keys(season.weeks).forEach(weekNum => {
      const week = season.weeks[weekNum];
      
      if (!week.matchups || !Array.isArray(week.matchups)) {
        return;
      }

      // Clear team names from each matchup
      week.matchups.forEach(matchup => {
        if (matchup.team1 !== null || matchup.team2 !== null) {
          matchup.team1 = null;
          matchup.team2 = null;
          yearCleared++;
        }
      });
    });

    totalCleared += yearCleared;
    console.log(`✅ ${year} - Cleared ${yearCleared} matchups across ${Object.keys(season.weeks).length} weeks`);
  });

  // Save the modified data
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`\n✅ DONE! Cleared ${totalCleared} total matchups`);
    console.log("\n📝 Next steps:");
    console.log("   1. Restart your server (if running)");
    console.log("   2. Navigate to the Edit Season page");
    console.log("   3. Enter team matchups for each week");
    console.log("   4. Enter scores as needed\n");
  } catch (err) {
    console.error("❌ Save failed:", err);
    process.exit(1);
  }
}

// ===============================
// RUN SCRIPT
// ===============================

clearTeams();