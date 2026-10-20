// Reads the text of ESPN's League Schedule page, copied out of a browser.
//
// Select-all on fantasy.espn.com/football/league/schedule and paste: what comes
// across is one value per line, with the site's navigation above and its footer
// below. Between them, each week starts with a header —
//
//   NFL Week 3Edit                      a regular-season week
//   Playoff Round 1 (NFL Week 15)       a playoff week, by its NFL week number
//
// — then the column titles (AWAY TEAM, TEAM MANAGER(S), Score, Score, TEAM
// MANAGER(S), HOME TEAM), then one game after another:
//
//   Welsh Wales          away team
//   (4-2-0)              its record today, not that week's
//   Brett Lewis          away manager
//   137.62               away score   } both absent for a week not played yet
//   113.14               home score   }
//   Will Friedenberger   home manager
//   Woody "skid" ...     home team
//   (2-4-0)              its record
//
// Blank lines fall wherever the page's layout put them, so they are dropped and
// carry no meaning. A playoff week not yet seeded reads "Matchups to be
// determined" and nothing else.
//
// Nothing here knows about the database. It turns the text into weeks of games
// and reports what it could not read, with the line it was on; whether a name
// is on the roster is the importer's question.

const REGULAR_WEEK = /^NFL Week (\d{1,2})(?:Edit)?$/;
const PLAYOFF_WEEK = /^Playoff Round (\d{1,2}) \(NFL Week (\d{1,2})\)$/;
const RECORD = /^\(\d+-\d+-\d+\)$/;
const SCORE = /^\d{1,3}(?:\.\d{1,2})?$/;

const COLUMN_TITLES = new Set(["AWAY TEAM", "TEAM MANAGER(S)", "Score", "HOME TEAM"]);
const TO_BE_DETERMINED = "Matchups to be determined";

/** The first line of the page's footer, where the last week ends. */
const FOOTER = "Fantasy Football Support";

/**
 * `{ year, weeks, problems }`. A week is `{ week, playoff, line, determined,
 * complete, games }`; a game is `{ line, away, home }`, and a side is `{ team, manager,
 * score }` with the score a number or null. A problem is `{ line, message }`,
 * line counted from 1 in the pasted text, or null when it belongs to no line.
 */
export function parseSchedule(text) {
  const lines = text.split(/\r?\n/).map((value, index) => ({ value: value.trim(), line: index + 1 }));
  const problems = [];

  const year = seasonYear(lines, problems);
  const sections = weekSections(lines);

  if (sections.length === 0) {
    problems.push({
      line: null,
      message:
        "No weeks found. Copy the whole League Schedule page (select all), with " +
        '"All" chosen under Team Schedule.',
    });
  }

  const weeks = sections.map((section) => readWeek(section, problems));

  const seen = new Set();
  for (const week of weeks) {
    if (seen.has(week.week)) {
      problems.push({ line: week.line, message: `Week ${week.week} appears twice in the paste.` });
    }
    seen.add(week.week);
  }

  return { year, weeks, problems };
}

/** The year under "Season:", which the page prints on a line of its own. */
function seasonYear(lines, problems) {
  const label = lines.findIndex((entry) => entry.value === "Season:");
  const value = label === -1 ? undefined : lines.slice(label + 1).find((entry) => entry.value !== "");

  if (value === undefined || !/^\d{4}$/.test(value.value)) {
    problems.push({
      line: label === -1 ? null : lines[label].line,
      message: 'Could not find the season\'s year (the "Season:" line near the top of the page).',
    });
    return null;
  }
  return Number(value.value);
}

/** Each week's header and the non-blank lines under it, up to the next header or the footer. */
function weekSections(lines) {
  const sections = [];
  let current = null;

  for (const entry of lines) {
    if (entry.value === FOOTER && current !== null) break;

    const regular = entry.value.match(REGULAR_WEEK);
    const playoff = entry.value.match(PLAYOFF_WEEK);

    if (regular || playoff) {
      current = {
        week: Number(regular ? regular[1] : playoff[2]),
        playoff: Boolean(playoff),
        line: entry.line,
        body: [],
      };
      sections.push(current);
      continue;
    }

    if (current !== null && entry.value !== "") current.body.push(entry);
  }

  return sections;
}

function readWeek(section, problems) {
  const body = section.body.filter((entry) => !COLUMN_TITLES.has(entry.value));
  const week = {
    week: section.week,
    playoff: section.playoff,
    line: section.line,
    determined: !body.some((entry) => entry.value === TO_BE_DETERMINED),
    // False when a game could not be read: the games after it are unknown, so
    // nothing can be said about who is missing from the week.
    complete: true,
    games: [],
  };
  if (!week.determined) return week;

  let i = 0;
  while (i < body.length) {
    const game = readGame(body, i);
    if (game === null) {
      problems.push({
        line: body[i].line,
        message:
          `Week ${section.week}: could not read a game starting at "${body[i].value}". ` +
          `Expected team, (record), manager, two scores, manager, team, (record).`,
      });
      week.complete = false;
      break;
    }
    week.games.push(game.game);
    i = game.next;
  }

  return week;
}

/** One game from position `i`, or null when the lines there are not one. */
function readGame(body, i) {
  const value = (offset) => body[i + offset]?.value;
  const isName = (offset) => {
    const v = value(offset);
    return v !== undefined && !RECORD.test(v) && !SCORE.test(v);
  };

  if (!isName(0) || !RECORD.test(value(1) ?? "") || !isName(2)) return null;

  const scored = SCORE.test(value(3) ?? "") && SCORE.test(value(4) ?? "");
  const home = scored ? 5 : 3;

  if (!isName(home) || !isName(home + 1) || !RECORD.test(value(home + 2) ?? "")) return null;

  return {
    game: {
      line: body[i].line,
      away: { team: value(0), manager: value(2), score: scored ? Number(value(3)) : null },
      home: { team: value(home + 1), manager: value(home), score: scored ? Number(value(4)) : null },
    },
    next: i + home + 3,
  };
}
