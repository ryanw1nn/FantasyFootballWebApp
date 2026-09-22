# View Dialect — Phase 6 Decision Record

Settled 2026-09-22, against the tree at `ea396f3`. No code was written for this
document. Every step of Phase 6 encodes these answers, which is why they are
decided before any of them start: changing one afterwards is a second pass over
every file that reads season data.

Phase 6 is the step where the client stops speaking the JSON file's dialect and
starts speaking the database's. The compatibility aliases (`GET /seasons`,
`GET /seasons/:year`, `GET /api/seasons/:year/weeks`, `PUT …`) keep running
untouched until Phase 7 deletes them; what changes is that nothing in `src/`
calls them any more.

The plan's Phase 6 card listed four bullets. Two were already answered by
earlier decisions, one was wrong about its difficulty, and the largest piece of
the phase was not on it at all. (a), (c) and (h) below restate decisions the
plan already made, so nobody re-litigates them; the rest are new.

## (a) No cross-league toggle

Decided in Phase 0: the two leagues are separate people, no roster overlap. So
"all-time" stays a single number per league, and every aggregation takes **one
league's seasons** and nothing else, by signature.

A cross-league toggle is the only feature whose job would be to add two leagues
together, which is exactly what the phase's gate forbids. Not built.

## (b) Aggregation moves into modules, not into a query

The card said to move `PlayerStatsPage`'s client-side aggregation into a
database query, because it would otherwise be "multiple leagues of data over the
network". That never happens: `LeagueLayout` fetches **one** league per visit,
and the whole-league payload is **102,953 bytes** for seven seasons
(`curl localhost:5001/seasons`, 2026-09-22).

**Decision: pure functions under `src/stats/`, no server aggregation route.**

- A SQL implementation would be a *second* implementation of every award and
  total, and no gate can diff derived numbers against the old ones — `api:parity`
  compares payloads, not results.
- Pure functions can be called from a Node harness with no React and no network,
  which is what makes the render diff in 6.3 possible. `client.js` and
  `routes.js` are already written that way.

Declined by name, so it can be revisited: a `GET /api/leagues/:slug/players/:name`
returning a career becomes the right move the day one league's payload stops
fitting comfortably in one request. At ~15 KB per season, that is decades away.

## (c) A player stays a display name in the URL

`routes.js` and `docs/url-grammar.md` both said Phase 6 *may* replace the name in
`/l/:slug/players/:name` with a player id. **It does not.**

- The new dialect exposes no player id at all: `teamsForSeasons`
  (`server/queries.mjs`) selects `p.display_name`, never `t.player_id`. Ids would
  mean a server change on top of a client change.
- Display names are unique *within* a league (the import enforces it), and every
  player URL carries its league, so a name is an unambiguous key where it is used.
- Every player link sent since Phase 5 keeps working.

`playerPath` and `decodePlayerName` stay the one place a name is encoded and
read back, so the switch remains a small change if it is ever wanted.

## (d) The botted slot

The database says `display_name: null`, `status: 'botted'`. The file said
`"Botted Season"`, a fake person invented by the serializer.

**Decision: one helper, `ownerLabel(team)`, returns `display_name`, or the words
`Botted Season` when `status === 'botted'`.**

The label stays what every regression check since Phase 2 has looked for, and it
becomes a presentation choice in one place rather than a player the server
invents. What changes, and is whitelisted in the render diff:

- not a link in the season table,
- no row in the all-time table when the *botted* filter is on,
- `/l/fan-club/players/Botted%20Season` is the empty player state,
- in head-to-head it stays one opponent, off by default, now keyed on
  `status === 'botted'` rather than on a substring match for "botted".

## (e) What a BYE is

The new dialect has no `"BYE"` string: a side is a team id or `null`. The rule
`server/serialize.mjs` already encodes moves to the client, in one helper:

- **exactly one side null → a BYE**
- **both sides null → a slot nobody has filled yet** (`db:season` lays every week
  out that way)

`isBye(matchup)` is used by the bracket, the player page and the editor, and is
never spelled twice.

*Known ambiguity, not fixed here:* a regular-season pairing saved with one side
still empty is stored exactly like a BYE, in either dialect. It predates Phase 6.

## (f) The bracket reads `status` and the season's shape

`PlayoffBracket.jsx` hardcodes weeks 15–17 and splits each week by array
position. That is not merely brittle, it is wrong for three seasons: in 2021,
2022 and 2023 week 15 positions 4–5 and week 16 position 2 carry
`status: "out"` and labels like `#9 SEED vs #12 SEED`, but `slice(4, 6)` draws
them under **Toilet Bowl**. 2024 and 2025 carry `toilet` at exactly those
positions, which is why the slicing looked right.

**Decision: categorise by `status`, order by `position` within each category, and
take the weeks from `season.playoff_start_week` through the last week that has
matchups.**

- Visible change: nine matchups leave the Toilet Bowl column — three per year for
  2021–2023. 2024 and 2025 do not move, which is the proof the rule agrees with
  the slicing wherever the slicing was right.
- A league with a different bracket renders correctly with no code of its own,
  which is what makes a second league's format a data question rather than a code
  question.

## (g) Awards are facts of a season, not of a filter

`Dashboard` hands `AllTimeTable` each season *after* the Team States filter, and
`AllTimeTable` then picks each year's PF leader, PA leader and last place from
what it was handed. Hiding a player hands their award to someone else.

In the working database this is live: Max Strater is `inactive` in every season,
the filter hides `inactive` by default, and Max finished 12th in both 2022 and
2024 — so *Regular Season Last Place* credits 2022 to Keith John (11th) and 2024
to the 10th-place team (2024's 11th, Michael Cassidy, is inactive too).

**Decision: compute every per-season award — PF leader, PA leader, last place,
both championships — over the whole season, then apply the filter to decide who
is listed.**

**And the same rule for totals: a player's career totals include every season
they played, whatever their status was.** `status` means "not part of the current
season" (the commissioner's own words, 2026-09-22). It answers *who is listed*.
It never changes what a season says or what a career adds up to.

## (h) The column keys stay global

`useColumnVisibility` stores which optional columns are shown under
`ff_season_table_columns` and `ff_alltime_table_columns`. The card said to pick
deliberately.

**Decision: leave them un-namespaced.** Which columns a reader likes is a
preference about a table's layout; both leagues have the same columns; and
namespacing would make a reader configure the same table twice. It cannot total
anything. The one reason to namespace — a league with different columns — does
not exist, and `tableColumns.js` would have to change first.

The Team States filter stays unpersisted component state. The URL is the state.

## (i) The whole-league route

**`GET /api/leagues/:slug/seasons`** answers:

```json
{ "seasons": { "2020": { "season": …, "teams": [], "standings": [], "weeks": {} } } }
```

Each value is exactly what `GET /api/leagues/:slug/seasons/:year` already
returns, built from the same `apiSeason`. Keyed by year because every consumer
looks a season up by year and `LeagueLayout` derives its year list from the keys;
wrapped in an object so the response can grow a field without changing type.

Built from `seasonsOfLeague` + `loadSeasons`: **5 round trips** for any number of
seasons — the alias's 4, plus the league lookup that tells an unknown league from
an empty one. A league with no seasons answers `{ "seasons": {} }`, not a 404;
the league exists.

## (j) Who fetches what, afterwards

- **`LeagueLayout`** calls `getSeasons(slug)`, now the route in (i).
- **The bracket** draws from that payload and drops its own fetch. Forced, not
  tidy: the new `/weeks` route returns weeks *without* teams, unlike the alias,
  and a matchup side is now an id that needs a teams list to become a name.
- **The editor** calls a new `getSeason(slug, year)` — the existing one-season
  route, which carries `season`, `teams` and `weeks` — for a fresh copy of the
  week it edits, and takes its year list from the layout instead of its own
  `getSeasons`.
- **`getWeeks` is deleted** from `src/api/client.js`; the server route stays, as
  deleting routes is Phase 7's job. The module keeps **eight** request functions,
  four of them sending the cookie.
- `ALIAS_LEAGUE` and `requireAliasLeague` are deleted once nothing calls an alias.

This also settles the "same week fetched three times" that Phase 4 counted and
Phase 5 left alone.

## (k) One join, and it renames nothing

The season table wants a row per team with its record; the new dialect keeps
`teams` and `standings` apart, joined on `team_id`. One helper in `src/stats/`
does that join, and **it does not rename a single key**: the joined row reads
`team_name`, `display_name`, `status`, `is_regular_champ`, `prev_place`.

A join that emits `name`, `state` and `rChampion` is `server/serialize.mjs`
rebuilt in the browser — a quirk taught to both ends never goes away. The dialect
grep in 6.1/6.12 is what enforces this.

## League two: after launch

**Decided 2026-09-22: the real second league is not added in Phase 6.** Phase 6
proves multi-league with a scratch league that is dropped the same day, and the
working database still holds one league when the phase closes.

Provisioning the real one is Phase 8, after the site is live, because two pieces
do not exist yet: nothing can create a league's *first* season (`db:season` copies
the previous one), and the league's own details — name, slug, format, roster —
are not settled. `db:season`'s per-league player lookup already handles a display
name shared with a Fan Club member, and Phase 8 reuses it rather than writing a
second rule.
