import React, { useMemo } from 'react';
import { Trophy, Award } from 'lucide-react';

import { categorizeMatchups, getWinner, playoffWeeks, roundTitle } from '../stats/bracket';
import { BYE_LABEL, isBye, ownerLabel, teamsById } from '../stats/league';

/**
 * PlayoffBracket Component
 *
 * Draws one column per playoff week of the season, and three segments:
 * Playoff, Toilet Bowl and Out games.
 */

export default function PlayoffBracket({ year, seasonData }) {
    // Both props come from the bracket's route, which reads them off the
    // layout's payload. The bracket used to fetch the week itself, which was
    // the third request for a season the layout had already loaded — and the
    // league-scoped weeks route carries no teams, so a side that is now an id
    // would have had nothing to become a name against.
    //
    // The weeks and the columns are the season's own: which weeks are playoff
    // weeks comes from `playoff_start_week`, and which column a game lands in
    // from its `status`. Neither is a literal any more, so a league whose
    // playoffs are two rounds starting in week 13 draws itself.
    const weeks = useMemo(() => playoffWeeks(seasonData), [seasonData]);

    const columns = useMemo(() => {
        const start = seasonData?.season?.playoff_start_week;

        return weeks.map((week) => ({
            week,
            title: roundTitle(week - start + 1, weeks.length),
            ...categorizeMatchups(seasonData?.weeks?.[week]),
        }));
    }, [seasonData, weeks]);

    // A side is a team id, and ids belong to a season.
    const teams = useMemo(() => teamsById(seasonData), [seasonData]);

    // One column per week, however many weeks the season's playoffs run.
    const gridColumns = { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` };

    // The file's dialect wrote a BYE as the opponent's *name*, so the word came
    // through as a team. Here one empty side is a BYE and two empty sides are a
    // slot nobody has filled (6.2(e)), which is what tells BYE from TBD.
    const sideName = (matchup, id) => {
        if (id != null) return ownerLabel(teams.get(id));
        return isBye(matchup) ? BYE_LABEL : null;
    };

    function renderMatchup(matchup, index) {

        const team1Name = sideName(matchup, matchup?.team1_id);
        const team2Name = sideName(matchup, matchup?.team2_id);

        const isByeWithScore = matchup?.team2_id == null && matchup?.team1_score != null;
        const hasRegularScores = matchup?.team1_score != null && matchup?.team2_score !== null;
        const hasTeamNames = team1Name || team2Name;

        if (!matchup || (!hasTeamNames && !isByeWithScore && !hasRegularScores)) {
            return (
                <div key={index} className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg p-3 text-center text-gray-400">
                    TBD
                </div>
            );
        }

        const winner = getWinner(matchup);

        return (
            <div key={index} className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm">
                <div className={`p-3 flex justify-between items-center ${
                    winner === 'team1' ? 'bg-green-50 border-b-2 border-green-500' : 'border-b border-gray-200'
                }`}>
                    <span className={`font-medium ${winner === 'team1' ? 'text-green-900' : 'text-gray-900'}`}>
                        {team1Name || 'TBD'}
                    </span>
                    {matchup.team1_score != null && (
                        <span className={`font-bold ${winner === 'team1' ? 'text-green-700' : 'text-gray-600'}`}>
                            {matchup.team1_score?.toFixed(1) || '-'}
                        </span>
                    )}
                </div>
      
                <div className={`p-3 flex justify-between items-center ${
                    winner === 'team2' ? 'bg-green-50' : ''
                }`}>
                    <span className={`font-medium ${winner === 'team2' ? 'text-green-900' : 'text-gray-900'}`}>
                        {team2Name || 'TBD'}
                    </span>
                    {matchup.team2_score && (
                        <span className={`font-bold ${winner === 'team2' ? 'text-green-700' : 'text-gray-600'}`}>
                            {matchup.team2_score?.toFixed(1) || '-'}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    if (year === 2020 || year === '2020') {
        return (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-8 text-center">
                <p className="text-yellow-800 font-semibold text-lg">
                    ⚠️ Playoff bracket not available for 2020 season
                </p>
                <p className="text-yellow-700 text-sm mt-2">
                    The 2020 season had an irregular playoff format
                </p>
            </div>
        );
    }

    if (columns.length === 0) {
        return (
            <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-8 text-center text-gray-500">
                No playoff games yet for {year}
            </div>
        );
    }

    const weekRange = columns.length === 1
        ? `Week ${columns[0].week}`
        : `Weeks ${columns[0].week}-${columns[columns.length - 1].week}`;

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
                    <Trophy className="text-yellow-500" size={32} />
                    {year} Playoff Bracket
                </h2>
                <p className="text-gray-600">{weekRange} • Championship Tournament</p>
            </div>

            {/* Week Headers */}
            <div className="grid gap-8 mb-3" style={gridColumns}>
                {columns.map((column) => (
                    <div key={column.week} className="text-center">
                        <h3 className="text-xl font-bold text-indigo-600">Week {column.week}</h3>
                        <p className="text-sm text-gray-500">{column.title}</p>
                    </div>
                ))}
            </div>

            {/* PLAYOFF BRACKET SECTION */}
            <div className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg p-4 border-2 border-yellow-200">
                <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-6 h-6 text-yellow-600" />
                    <h3 className="text-xl font-bold text-gray-800">Playoff Bracket</h3>
                </div>
                
                <div className="grid gap-8" style={gridColumns}>
                    {/* Each later round has fewer games, and centres against the first */}
                    {columns.map((column, index) => (
                        <div
                            key={column.week}
                            className="flex flex-col justify-center space-y-2.5"
                            style={index === 0 ? undefined : { minHeight: '440px' }}
                        >
                            {column.bracket.map((matchup, idx) => renderMatchup(matchup, idx))}
                        </div>
                    ))}
                </div>
            </div>

            {/* TOILET BOWL SECTION */}
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 border-2 border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">🧻</span>
                    <h3 className="text-xl font-bold text-gray-800">Toilet Bowl</h3>
                </div>
                
                <div className="grid gap-8" style={gridColumns}>
                    {columns.map((column, index) => (
                        <div
                            key={column.week}
                            className="flex flex-col justify-center space-y-2.5"
                            style={index === 0 ? undefined : { minHeight: '220px' }}
                        >
                            {column.toiletBowl.map((matchup, idx) => renderMatchup(matchup, idx))}
                        </div>
                    ))}
                </div>
            </div>

            {/* OUT GAMES SECTION */}
            <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-4 border-2 border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">🏈</span>
                    <h3 className="text-xl font-bold text-gray-800">Out Games</h3>
                </div>
                
                <div className="grid gap-8" style={gridColumns}>
                    {columns.map((column) => (
                        <div
                            key={column.week}
                            className="flex flex-col justify-center space-y-2.5"
                            style={{ minHeight: '150px' }}
                        >
                            {column.out.length === 0 ? (
                                <div className="text-gray-400 text-sm text-center">No games</div>
                            ) : (
                                column.out.map((matchup, idx) => renderMatchup(matchup, idx))
                            )}
                        </div>
                    ))}
                </div>
            </div>
                    
            <div className="mt-8 bg-white rounded-lg shadow-md p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Legend</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-50 border-2 border-green-500 rounded"></div>
                        <span>Winner</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-yellow-500" />
                        <span>Playoff games</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-blue-500" />
                        <span>Toilet Bowl games</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
