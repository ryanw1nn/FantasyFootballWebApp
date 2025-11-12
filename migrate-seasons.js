/**
 * ===============================
 * DATA MIGRATION SCRIPT
 * ===============================
 * 
 *  This script migrates the old season data format to the new structure
 *  that supports week-by-week matchup trackingl
 * 
 * OLD FORMAT:
 * {
 *   "2025": [
 *     { team: "...", name: "...", wins: 5, losses: 3, pf: 1000, pa: 950, ... }
 *   ]
 * }
 * 
 * NEW FORMAT:
 * {
 *   "2025": {
 *     teams: [
 *       { team: "...", name: "...", state: "active", playoff: {...}, ... }
 *     ],
 *     weeks: {
 *       "1": {
 *         matchups: [
 *           { team1: "Team A", team1Score: 120.5, team2: "Team B", team2Score: 115.3 }
 *         ]
 *       }
 *     },
 *     standings: [
 *       { place: 1, team: "...", wins: 5, losses: 3, pf: 1000, pa: 950, ... }
 *     ]
 *   }
 * }
 * 
 * USAGE:
 *  node migrate-seasons.js
 * 
 * NOTE: This script creates a backup before migration`
 * 
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
const OUTPUT_FILE = path.join(__dirname, "src", "data", "seasons-migrated.json");

// Default number of regular season weeks
const DEFAULT_WEEKS = 14;

// ===============================
// HELPER FUNCTIONS
// ===============================

/**
 * Create a backup of the original files
 */
function createBackup(data) {
    const timestamp = new Data().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `seasons-pre-migration-${timestamp}.json`);

    // Create backups directory if it doesn't exist
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR);
    }

    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
    console.log(`Backup created: ${backupFile}`);
    return backupFile;
}

/**
 * Generate empty matchups structure for a season
 * This creates placeholders that can be filled in via the edit interface
 */
function createBackup(data) {
    const weeks = {};
    const teamCount = teams.length;
    const matchupsPerWeek = Math.floor(teamCount / 2);

    for (let week = 1; week <= numWeeks; week++){
        const matchups = [];

        // Create placeholder matchups (teams will need to be assigned manually)
        for (let m = 0; m < matchupsPerWeek; m++) {
            matchups.push({
                team1: teams[m * 2]?.team || `Team ${m * 2 + 1}`,
                team1Score: null,
                team2: teams[m * 2 + 1]?.team || `Team ${m * 2 + 2}`,
                team2Score: null
            });
        }

        weeks[week] = { matchups };
    }

    return weeks;
}

/**
 * Migrate a single season from old format to new format
 */
function migrateSeason(seasonData, year) {
    console.log(`\n Migrating ${year}...`);

    // If already in new format, skip
    if (seasonData.teams && seasonData.weeks) {
        console.log(`   Already migrated, skipping`);
        return seasonData;
    }

    // If not an array, assume it's malformed
    if (!Array.isArray(seasonData)) {
        console.log(`   Invalid format, skipping`);
        return seasonData;
    }

    // Extract team roster (remove stats, keep metadata)
    const teams = seasonData.map(team => ({
        team: team.team,
        name: team.name,
        state: team.state || "active",
        playoff: team.playoff || { made: false, round: 0, pChampion: false },
        rChampion: team.rChampion || false
    }));

    // Generate empty week structure
    const weeks = generateEmptyMatchups(teams);

    // Keep original standings as starting point
    const standings = seasonData.map((team, idx) => ({
        ...team,
        place: team.place || idx + 1,
        prevPlace: team.prevPlace || team.place || idx + 1
    }));

    console.log(`   Migrated ${teams.length} teams, ${Object.keys(weeks).length} weeks (empty)`);

    return {
        teams,
        weeks,
        standings
    };
}

/**
 * Main migration function
 */
function migrateData() {
    console.log(" Starting data migration...\n");

    // Load existing data
    let seasonsData;
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        seasonsData = JSON.parse(raw);
        console.log(`   Loaded data from: ${DATA_FILE}`);
        console.log(`   Found ${Object.keys(seasonsData).length} seasons: ${Object.keys(seasonsData).join(", ")}`);
    } catch (err) {
        console.error(" Failed to load seasons.json:", err.message);
        process.exit(1);
    }

    // Create backup
    createBackup(seasonsData);

    // Migrate each season
    const migratedData = {};
    Object.keys(seasonsData).forEach(year => {
        migratedData[year] = migrateSeason(seasonsData[year], year);
    });

    // Save migrated data to new file (for safety)
    try {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(migratedData, null, 2));
        console.log(`\n Migration complete!`);
        console.log(`   Output saved to: ${OUTPUT_FILE}`);
        console.log(`\n IMPORTANT: Review the migrated file before replacing the original!`);
        console.log(`   If everything looks good, run:`);
        console.log(`   cp ${OUTPUT_FILE} ${DATA_FILE}`);
    } catch (err) {
        console.error(" Failed to save migrated data:", err.message);
        process.exit(1);
    }
}

// ===============================
// RUN MIGRATION
// ===============================

// Check if running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log("════════════════════════════════════════");
    console.log("   FANTASY FOOTBALL DATA MIGRATION");
    console.log("════════════════════════════════════════\n");

    // Confirm with user
    console.log("⚠️  WARNING: This will restructure your season data.");
    console.log("   A backup will be created automatically.\n");

    // For safety, require explicit confirmation
    if (process.argv.includes("--confirm")) {
        migrateData();
    } else {
        console.log("To proceed, run:");
        console.log("   node migrate-seasons.js --confirm\n");
    }
}

export { migrateSeason, generateEmptyMatchups };