# URL Grammar — Phase 5 Decision Record

Settled 2026-09-18, against the tree at `7be4222`. No code was written for this
document, and none of it is implemented yet. Every step of Phase 5 writes this
grammar into a file, which is why it is decided before any of them start:
changing it afterwards is a second pass over every file that encodes it.

The plan's decision card said `/l/:slug/:view` with the year as a query param.
What follows is that grammar with the five views filled in, the judgement calls
made, and two gaps closed that the card did not name.

## The routes

| URL | Opens | Today |
| --- | --- | --- |
| `/` | Redirect to `/l/fan-club/season` | — |
| `/l/:slug` | Redirect to `/l/:slug/season` | — |
| `/l/:slug/season?year=2026` | Dashboard, season table | `App.jsx:268–428`, `viewMode === "season"` |
| `/l/:slug/alltime?year=2026` | Dashboard, all-time table. The table ignores the year; see the amendment below. | same block, `viewMode === "alltime"` |
| `/l/:slug/bracket?year=2026` | Playoff bracket | `App.jsx:203–247` early return |
| `/l/:slug/edit?year=2026` | Season editor | `App.jsx:163–167` early return → `EditSeasonPage` |
| `/l/:slug/players/:name?year=2026` | One player's career | `App.jsx:189–197` early return → `PlayerStatsPage` |
| anything else | The 404 page | — |

`:name` is the display name, URI-encoded: `/l/fan-club/players/TJ%20Cairney`.

### The two the card did not name

**`/l/:slug` redirects, it does not 404.** A bare league URL is what a truncated
paste and a hand-typed address both produce, and the league exists — only the
view is missing. A 404 there tells a reader the league is gone, which is a lie.
It is an index route redirecting to `season`, the same answer `/` gives.

**`/l/:slug/players` with no name is a 404.** There is no player index page and
Phase 5 is not the place to invent one. The path simply does not match.

## The four judgement calls

### 1. The year is a query param, not a path segment

Two of the five views have no year — `alltime` spans every season and `players`
spans a career — so a segment would force a placeholder into two URLs with
nothing to put there. A query param is also droppable: `/l/fan-club/season` with
no year is a valid link meaning "the latest", which is the link actually worth
sending someone.

The param is a **string** in the URL and both existing year states disagree
about type — `App.jsx:49` holds `useState(null)` and sets a `Number`,
`EditSeasonPage.jsx:36` holds `useState('')` and sets a `String` off
`Object.keys`. 5.7's hook returns one type and every caller takes it from there;
comparisons against `season_years` (numbers, from Postgres) convert once, inside
the hook.

### 2. Push on a view or a league, replace on a year

Changing the view or the league is a navigation and goes on the history stack.
Changing the year in the select is `{ replace: true }` — a back button that
walks back through six years of one table before leaving the page is a worse
back button than one that leaves. Decided here, once, rather than per call site.

### 3. A player is still a name

Today a player *is* a display-name string: `App.jsx:113`'s `handlePlayerClick`
takes the name, and `PlayerStatsPage.jsx:56–57` matches it against both sides of
every matchup. Putting the name in the URL changes nothing about identity and
keeps this phase to routing.

It does mean the encoding matters — the names have spaces in them. Read and
write that segment through `encodeURIComponent` / `decodeURIComponent` in **one
place**, in `src/routes.js`.

### 4. `/l/`, and not `/fan-club/`

The prefix keeps the league namespace from colliding with anything the app adds
at the root later — `/about`, `/healthz`, a future global `/players`. It costs
two characters, and it is what the plan already recorded. Not revisited.

## The path builder

One module, `src/routes.js`, builds every URL in the grammar. Every `<Link>` and
every `navigate()` goes through it. This is 4.3's argument about the base URL one
layer up: a string built in nine places drifts in nine places, and 5.8's switcher
has to build all five.

The surface, as decided — the module lands in 5.3:

| Function | Returns |
| --- | --- |
| `homePath()` | `/` |
| `leaguePath(slug)` | `/l/:slug` |
| `seasonPath(slug, year?)` | `/l/:slug/season`, `?year=` when a year is given |
| `alltimePath(slug, year?)` | `/l/:slug/alltime` — carries the year, never reads it |
| `bracketPath(slug, year?)` | `/l/:slug/bracket` |
| `editPath(slug, year?)` | `/l/:slug/edit` |
| `playerPath(slug, name, year?)` | `/l/:slug/players/:name`, name encoded here |
| `decodePlayerName(param)` | The one `decodeURIComponent` call site |

An omitted or null `year` emits no `?year=` at all, because a missing param is
"the latest" and is not a mistake to be corrected.

## What `/l/fan-club/season?year=1999` does

It opens the league's latest season, and rewrites the address bar to say so —
`?year=2026` today. It is **not** a 404.

The distinction Phase 5 rests on: a slug is an identity, a year is a hint. An
unknown league is a page that does not exist. An unknown year is a question with
an obvious better answer, and answering it with a dead end means every link that
outlives a season change breaks.

Falling back *silently* is the other half of the mistake — `?year=1999` sitting
next to a table showing 2026 is an address that lies, and one the reader will
copy and send on. Resolve, then replace the URL with the year actually shown.
A *missing* `?year=` gets no rewrite: it already means "the latest".

Validation is against the league, not a regex. Four digits is not enough — 1999
is well-formed, and so is 2019. The season list is `season_years` from
`getLeagues()`, which `server/queries.mjs:45` emits **oldest year first**
(`array_agg(s.year ORDER BY s.year)`), and `server/serialize-api.mjs:18–25`
already derives `latest_year` from it as `season_years.at(-1)`. The client does
not need to re-derive "latest"; it is a field.

`server/validate.mjs:26–29` refuses a non-four-digit year with a 400 before the
pool is touched, so a malformed year that somehow reaches the network is safe.
The client's job is to not ask.

## Corrections to the plan, read off the tree

- `EditSeasonPage`'s `selectedYear` is at **`:36`**, not `:35`.
- `LeagueContext.jsx:56`'s guard flag is named **`current`**, not `cancelled`.
  The behaviour the plan describes is the behaviour it has.
- `apiLeagues` returns **`latest_year`** alongside `season_years`. The plan's
  5.7 cites only `season_years`; the resolved-latest case is already served.

Everything else 5.2 asserts held to the digit: `App.jsx:203–247` and `268–428`
are the bracket and dashboard blocks, `App.jsx:113` passes the display name,
`EditSeasonPage.jsx:524` renders the unlock form as the whole page — so `/edit`
is deep-linkable while locked — and `grep -rn "viewMode" src/` is 13 lines, all
of them in `App.jsx`.

## What this record does not decide

- **Which component renders which route.** 5.4 through 5.6.
- **Who fetches the season payload.** 5.5.
- **What the 404 page looks like.** 5.9 — this record only says which of the
  four unknowns reach it: the slug and the path, not the year and not the name.
- **The switcher's markup.** 5.8. The grammar only guarantees it can build
  every target URL from `(slug, view, year)`.
- **Anything server-side.** No route in this table changes `server/`, `db/` or
  `scripts/`. Express learning to return `index.html` for an unknown path is
  Phase 7's, and until it does, every deep link here is a link to Vite on 5173.

## Amendment, 2026-09-21: all-time carries the year

The table above first said `/l/:slug/alltime` takes no year. Implementing the
year param reversed that. The all-time *table* still ignores the year, but the
stats cards above it are the selected season's, and a year dropped on the way
through all-time is a year lost on the way back to `season`. So every view
carries `?year=` when the URL has one and omits it when it doesn't, and the URL
is the only thing that remembers which season the reader was on.

Two details the implementation settled:

- **A year is matched as a string against the league's seasons.** `?year=2021.0`
  is not 2021; it resolves to the latest and is rewritten, like `?year=1999`.
- **The editor opens on the URL's year**, and its own select may then move away
  from it without touching the address bar.

## Amendment, 2026-09-23: the name stays, and it is not provisional

Judgement call 3 above left the door open for a player id in the URL. It is
shut. The league-scoped payload exposes no player id at all — `teamsForSeasons`
selects `p.display_name` and not `t.player_id` — so an id in the URL would mean
a server change before it meant a grammar change, and it would break every
player link sent since the views went live. Names are unique *within* a league,
the import enforces that, and every player URL carries its league, so a name is
an unambiguous key wherever this grammar uses one.

`playerPath` and `decodePlayerName` remain the one place the segment is spelled,
for the reason encoding gave them rather than as a hedge against a switch that
is no longer planned.
