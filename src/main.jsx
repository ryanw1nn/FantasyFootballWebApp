import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import LeagueLayout from "./components/LeagueLayout";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./components/Dashboard";
import BracketPage from "./components/BracketPage";
import EditSeasonPage from "./components/EditSeasonPage";
import PlayerStatsPage from "./components/PlayerStatsPage";
import NotFound from "./components/NotFound";
import { DEFAULT_LEAGUE } from "./context/LeagueContext";
import { seasonPath } from "./routes";
import './index.css';

/**
 * One player's career, remounted whenever the URL names a different player.
 *
 * The page's opponent filters and head-to-head sort are initialised from the
 * player they were first rendered for, and React reuses the component when only
 * a route param changes — so walking from one player to another carried the
 * first player's filter map onto the second, and left the second player's
 * botted opponent switched on. A key on this element is the whole fix; the
 * league provider above must never be keyed, which is why the key sits here.
 */
function PlayerStats() {
    const { slug, name } = useParams();
    return <PlayerStatsPage key={`${slug}/${name}`} />;
}

/** Sends a league URL with no view to that league's season table. */
function ToSeason() {
    const { slug } = useParams();
    return <Navigate to={seasonPath(slug)} replace />;
}

// Every view is an address. The provider lives under /l/:slug so the league
// being viewed is the one the URL names, and the three views that share a
// toolbar sit under one more layout that draws it.
ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <Routes>
                <Route
                    path="/"
                    element={<Navigate to={seasonPath(DEFAULT_LEAGUE)} replace />}
                />
                <Route path="/l/:slug" element={<LeagueLayout />}>
                    {/* A bare league URL is a truncated paste, not a dead page. */}
                    <Route index element={<ToSeason />} />
                    <Route element={<DashboardLayout />}>
                        <Route path="season" element={<Dashboard view="season" />} />
                        <Route path="alltime" element={<Dashboard view="alltime" />} />
                        <Route path="bracket" element={<BracketPage />} />
                    </Route>
                    <Route path="edit" element={<EditSeasonPage />} />
                    <Route path="players/:name" element={<PlayerStats />} />
                    <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>
);
