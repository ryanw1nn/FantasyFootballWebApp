import React from "react";

export default function SeasonDropdown({ years, selectedYear, onChange }) {
    return (
        <select
            value={selectedYear}
            onChange={(e) => onChange(e.target.value)}
            style={{ marginBottom: "1rem", padding: "0.5rem" }}
        >
            {years.map((year) => (
                <option key={year} value={year}>
                    {year}
                </option>
            ))}
        </select>
    );
}