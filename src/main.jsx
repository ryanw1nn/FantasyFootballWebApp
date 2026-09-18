import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { DEFAULT_LEAGUE, LeagueProvider } from "./context/LeagueContext";
import { seasonPath } from "./routes";
import './index.css';

// The router sits outside the provider for now: the provider still serves its
// default slug, and the layout that hands it one off the URL is the next step.
// Every path but "/" renders App unchanged, so navigation is still App's own
// view state — the only thing this shell changes is that "/" names a league.
ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <LeagueProvider>
                <Routes>
                    <Route
                        path="/"
                        element={<Navigate to={seasonPath(DEFAULT_LEAGUE)} replace />}
                    />
                    <Route path="*" element={<App />} />
                </Routes>
            </LeagueProvider>
        </BrowserRouter>
    </React.StrictMode>
);
