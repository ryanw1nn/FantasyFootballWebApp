// The league-scoped routes, which speak the database's own terms — team ids,
// playoff_rounds as the rung reached, status rather than state, null opponents
// rather than "BYE". Nothing consumes them yet, and they must never learn the
// file's quirks: that is what server/routes/legacy.js is for.
import express from "express";

export const router = express.Router();
