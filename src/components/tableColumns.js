// Optional/toggleable column definitions for SeasonTable and AllTimeTable.
// Rank/Team/Owner (season) and Player (all-time) are always shown and aren't listed here.
//
// `group` clusters columns under a shared header band so regular-season stats,
// regular-season awards, and postseason awards read as visually distinct sections.

export const SEASON_COLUMNS = [
  { key: 'change', label: 'Rank Change (Δ)', group: 'stats' },
  { key: 'winPct', label: 'Win %', group: 'stats' },
  { key: 'pf', label: 'Points For', group: 'stats' },
  { key: 'pa', label: 'Points Against', group: 'stats' },
  { key: 'pfpg', label: 'PF Per Game', group: 'stats' },
  { key: 'papg', label: 'PA Per Game', group: 'stats' },
];

export const ALLTIME_COLUMNS = [
  { key: 'losses', label: 'Losses', group: 'stats' },
  { key: 'ties', label: 'Ties', group: 'stats' },
  { key: 'gp', label: 'Games Played', group: 'stats' },
  { key: 'pfpg', label: 'PF Per Game', group: 'stats' },
  { key: 'papg', label: 'PA Per Game', group: 'stats', defaultVisible: false },
  { key: 'pfTotal', label: 'Points For (Total)', group: 'stats', defaultVisible: false },
  { key: 'paTotal', label: 'Points Against (Total)', group: 'stats', defaultVisible: false },
  { key: 'mpf', label: 'Scoring Titles (PF Leader)', group: 'regAwards' },
  { key: 'rs', label: 'Regular Season Titles', group: 'regAwards' },
  { key: 'paLdr', label: 'PA Leader (Most Points Allowed)', group: 'regAwards', defaultVisible: false },
  { key: 'regLoser', label: 'Regular Season Last Place', group: 'regAwards', defaultVisible: false },
  { key: 'rounds', label: 'Playoff Rounds Won', group: 'postAwards' },
  { key: 'po', label: 'Playoff Titles', group: 'postAwards' },
];

// Header-band labels for the grouped columns, keyed by group id.
export const SEASON_GROUPS = {
  stats: 'Regular Season',
};

export const ALLTIME_GROUPS = {
  stats: 'Regular Season',
  regAwards: 'Reg. Season Awards',
  postAwards: 'Postseason Awards',
};
