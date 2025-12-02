import React, { useState, useEffect } from 'react';
import { Trophy, Award } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * PlayoffBracket Component
 * 
 * Displays playoff bracket for weeks 15-17
 * Shows three segments: Playoff, Toilet Bowl, and Out games
 */

export default function PlayoffBracket({ year }) {
    const [weeks, setWeeks] = useState({ 15: null, 16: null, 17: null });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBracketData();
    }, [year]);

    async function loadBracketData() {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/seasons/${year}/weeks`);
            const data = await response.json();

            const bracketWeeks = {
                15: data.weeks?.['15'] || null,
                16: data.weeks?.['16'] || null,
                17: data.weeks?.['17'] || null
            };

            setWeeks(bracketWeeks);
        } catch (err) {
            console.error('Failed to load bracket data:', err);
        } finally {
            setLoading(false);
        }
    }

    function categorizeMatchups(weekMatchups, weekNum) {
        if (!weekMatchups || !weekMatchups.matchups) {
            return { playoff: [], toiletBowl: [], out: [] };
        }

        const matchups = weekMatchups.matchups;

        if (weekNum === 15) {
            return {
                playoff: matchups.slice(0, 4),
                toiletBowl: matchups.slice(4, 6),
                out: matchups.slice(6)
            };
        } else if (weekNum === 16) {
            return {
                playoff: matchups.slice(0, 2),
                toiletBowl: matchups.slice(2, 3),
                out: matchups.slice(3)
            };
        } else if(weekNum === 17) {
            return {
                playoff: matchups.slice(0, 1),
                toiletBowl: [],
                out: matchups.slice(1)
            };
        }

        return {
            playoff: matchups.slice(0, 2),
            toiletBowl: matchups.slice(2, 4),
            out: matchups.slice(4)
        };
    }

    function getWinner(matchup) {
        if (!matchup.team1Score || !matchup.team2Score) return null;
        return matchup.team1Score > matchup.team2Score ? 'team1' : 'team2';
    }

    function renderMatchup(matchup, index, weekNum) {
        if (!matchup || (!matchup.team1 && !matchup.team2)) {
            return (
                <div key={index} className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg p-3 text-center text-gray-400">
                    TBD
                </div>
            );
        }

        const winner = getWinner(matchup);
        const hasScores = matchup.team1Score !== null && matchup.team2Score !== null;

        return (
            <div key={index} className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm">
                <div className={`p-3 flex justify-between items-center ${
                    winner === 'team1' ? 'bg-green-50 border-b-2 border-green-500' : 'border-b border-gray-200'
                }`}>
                    <span className={`font-medium ${winner === 'team1' ? 'text-green-900' : 'text-gray-900'}`}>
                        {matchup.team1 || 'TBD'}
                    </span>
                    {hasScores && (
                        <span className={`font-bold ${winner === 'team1' ? 'text-green-700' : 'text-gray-600'}`}>
                            {matchup.team1Score?.toFixed(1) || '-'}
                        </span>
                    )}
                </div>
      
                <div className={`p-3 flex justify-between items-center ${
                    winner === 'team2' ? 'bg-green-50' : ''
                }`}>
                    <span className={`font-medium ${winner === 'team2' ? 'text-green-900' : 'text-gray-900'}`}>
                        {matchup.team2 || 'TBD'}
                    </span>
                    {hasScores && (
                        <span className={`font-bold ${winner === 'team2' ? 'text-green-700' : 'text-gray-600'}`}>
                            {matchup.team2Score?.toFixed(1) || '-'}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // get categorized data for all weeks
    const week15Data = categorizeMatchups(weeks[15], 15);
    const week16Data = categorizeMatchups(weeks[16], 16);
    const week17Data = categorizeMatchups(weeks[17], 17);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading playoff bracket...</p>
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

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
                    <Trophy className="text-yellow-500" size={32} />
                    {year} Playoff Bracket
                </h2>
                <p className="text-gray-600">Weeks 15-17 • Championship Tournament</p>
            </div>

            {/* Week Headers */}
            <div className="grid grid-cols-3 gap-8 mb-3">
                <div className="text-center">
                    <h3 className="text-xl font-bold text-indigo-600">Week 15</h3>
                    <p className="text-sm text-gray-500">Quarterfinals</p>
                </div>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-indigo-600">Week 16</h3>
                    <p className="text-sm text-gray-500">Semifinals</p>
                </div>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-indigo-600">Week 17</h3>
                    <p className="text-sm text-gray-500">Championship</p>
                </div>
            </div>

            {/* PLAYOFF BRACKET SECTION */}
            <div className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg p-4 border-2 border-yellow-200">
                <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-6 h-6 text-yellow-600" />
                    <h3 className="text-xl font-bold text-gray-800">Playoff Bracket</h3>
                </div>
                
                <div className="grid grid-cols-3 gap-8">
                    {/* Week 15 Playoff - 4 games */}
                    <div className="flex flex-col justify-center space-y-2.5">
                        {week15Data.playoff.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>

                    {/* Week 16 Playoff - 2 games (centered) */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '440px' }}">
                        {week16Data.playoff.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>

                    {/* Week 17 Playoff - 1 game (centered) */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '440px' }}">
                        {week17Data.playoff.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>
                </div>
            </div>

            {/* TOILET BOWL SECTION */}
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 border-2 border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                    <Award className="w-6 h-6 text-blue-600" />
                    <h3 className="text-xl font-bold text-gray-800">Toilet Bowl</h3>
                </div>
                
                <div className="grid grid-cols-3 gap-8">
                    {/* Week 15 Toilet Bowl - 2 games */}
                    <div className="flex flex-col justify-center space-y-2.5">
                        {week15Data.toiletBowl.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>

                    {/* Week 16 Toilet Bowl - 1 game (centered) */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '220px' }}">
                        {week16Data.toiletBowl.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>

                    {/* Week 17 Toilet Bowl - 0 games */}
                    <div className="flex flex-col justify-center items-center space-y-2.5" style={{ minHeight: '220px' }}>
                        {week17Data.toiletBowl.map((matchup, idx) => renderMatchup(matchup, idx))}
                    </div>
                </div>
            </div>

            {/* OUT GAMES SECTION */}
            <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-4 border-2 border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">🏈</span>
                    <h3 className="text-xl font-bold text-gray-800">Out Games</h3>
                </div>
                
                <div className="grid grid-cols-3 gap-8">
                    {/* Week 15 Out Games */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '150px' }}>">
                        {week15Data.out.length === 0 ? (
                            <div className="text-gray-400 text-sm text-center">No games</div>
                        ) : (
                            week15Data.out.map((matchup, idx) => renderMatchup(matchup, idx))
                        )}
                    </div>

                    {/* Week 16 Out Games */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '150px' }}>">
                        {week16Data.out.length === 0 ? (
                            <div className="text-gray-400 text-sm text-center">No games</div>
                        ) : (
                            week16Data.out.map((matchup, idx) => renderMatchup(matchup, idx))
                        )}
                    </div>

                    {/* Week 17 Out Games */}
                    <div className="flex flex-col justify-center space-y-2.5 style={{ minHeight: '150px' }}>">
                        {week17Data.out.length === 0 ? (
                            <div className="text-gray-400 text-sm text-center">No games</div>
                        ) : (
                            week17Data.out.map((matchup, idx) => renderMatchup(matchup, idx))
                        )}
                    </div>
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