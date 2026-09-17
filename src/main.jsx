import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LeagueProvider } from "./context/LeagueContext";
import './index.css';

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <LeagueProvider>
            <App />
        </LeagueProvider>
    </React.StrictMode>
);
