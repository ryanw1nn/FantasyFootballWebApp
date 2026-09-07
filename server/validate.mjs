// The three values that arrive from the network, checked before the pool is
// touched.
//
// Parameterized queries make a bad :year safe, not sensible: /seasons/abc is a
// 400, not a 500 from "invalid input syntax for type integer". Every parser
// below takes what the URL gives — a string — and returns the typed value the
// queries bind, so a caller cannot forget the conversion.
import { RequestError } from "./errors.mjs";

/** League slugs are lowercase, hyphenated and short; "fan-club" is the only one. */
const SLUG = /^[a-z0-9-]{1,40}$/;

/** Four digits, so a year is never negative, fractional or 20250. */
const YEAR = /^\d{4}$/;

/** Regular season plus playoffs never reaches 30 weeks. */
const MIN_WEEK = 1;
const MAX_WEEK = 30;

export function parseSlug(value) {
  if (typeof value !== "string" || !SLUG.test(value)) {
    throw new RequestError(400, "Invalid league");
  }
  return value;
}

export function parseYear(value) {
  if (!YEAR.test(String(value))) throw new RequestError(400, "Invalid year");
  return Number(value);
}

export function parseWeek(value) {
  const week = Number(value);
  if (!Number.isInteger(week) || week < MIN_WEEK || week > MAX_WEEK) {
    throw new RequestError(400, "Invalid week");
  }
  return week;
}
