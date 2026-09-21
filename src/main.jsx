import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import LeagueLayout from "./components/LeagueLayout";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./components/Dashboard";
import BracketPage from "./components/BracketPage";
import EditSeasonPage from "./components/EditSeasonPage";
import PlayerStatsPage from "./components/PlayerStatsPage";
import { DEFAULT_LEAGUE } from "./context/LeagueContext";
import { homePath, seasonPath } from "./routes";
import './index.css';

/**
 * Sends a league URL with no view, or one this app does not have, to that
 * league's season table. The second half is a stand-in: an unknown path gets a
 * real 404 page once one exists.
 */
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
                    <Route path="players/:name" element={<PlayerStatsPage />} />
                    <Route path="*" element={<ToSeason />} />
                </Route>
                <Route path="*" element={<Navigate to={homePath()} replace />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>
);
