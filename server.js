import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// Middleware
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Path to the JSON file
const dataFile = path.join(__dirname, "src", "data", "seasons.json");

// Load the data into memory
let seasonsData = {};
try {
  const raw = fs.readFileSync(dataFile, "utf-8");
  console.log("Raw file content length:", raw.length); 
  console.log(raw.slice(0, 500));
  seasonsData = JSON.parse(raw);
  console.log("Seasons data loaded. Keys:", Object.keys(seasonsData));
} catch (err) {
  console.error("Could not load seasons.json:", err);
}

// GET all seasons
app.get("/seasons", (req, res) => {
  res.json(seasonsData);
});

// GET a single season
app.get("/seasons/:year", (req, res) => {
  const { year } = req.params;
  if (!seasonsData[year]) return res.status(404).json({ error: "Year not found" });
  res.json(seasonsData[year]);
});

// UPDATE a season (replace the whole array)
app.post("/seasons/:year", (req, res) => {
  const { year } = req.params;
  const newData = req.body;
  if (!Array.isArray(newData)) return res.status(400).json({ error: "Data must be an array" });

  seasonsData[year] = newData;

  // Save to disk
  try {
    fs.writeFileSync(dataFile, JSON.stringify(seasonsData, null, 2));
    res.json({ success: true, year });
  } catch (err) {
    console.error("Error writing file:", err);
    res.status(500).json({ error: "Failed to save data" });
  }
});

// UPDATE a single team in a season
app.patch("/seasons/:year/:team", (req, res) => {
  const { year, team } = req.params;
  const updatedTeam = req.body;

  if (!seasonsData[year]) return res.status(404).json({ error: "Year not found" });

  const teamIndex = seasonsData[year].findIndex(t => t.team === team);
  if (teamIndex === -1) return res.status(404).json({ error: "Team not found" });

  seasonsData[year][teamIndex] = { ...seasonsData[year][teamIndex], ...updatedTeam };

  // Save to disk
  try {
    fs.writeFileSync(dataFile, JSON.stringify(seasonsData, null, 2));
    res.json({ success: true, team });
  } catch (err) {
    console.error("Error writing file:", err);
    res.status(500).json({ error: "Failed to save data" });
  }
});

app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
