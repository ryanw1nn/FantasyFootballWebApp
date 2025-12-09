# Fantasy Football League Dashboard

A comprehensive web application for tracking and managing fantasy football league statistics across multiple seasons. Built with React, Express, and Tailwind CSS, this dashboard provides real-time insights into team performance, head-to-head matchups, and playoff brackets.

## Features

### Core Functionality
- **Multi-Season Tracking**: View and compare league statistics across different seasons
- **Real-Time Statistics**: Live calculation of wins, losses, points for/against, and win percentages
- **Interactive Dashboards**: Multiple view modes for different use cases
- **Playoff Bracket Visualization**: Visual representation of playoff matchups and progression
- **Season Editor**: Full CRUD operations for managing matchups, scores, and team data

### View Modes
- **Season View**: Detailed standings and statistics for a selected season
- **All-Time View**: Aggregated statistics across all seasons with sortable metrics
- **Edit Mode**: Administrative interface for updating season data
- **Bracket View**: Tournament-style visualization of playoff matchups

### Key Metrics
- Win-Loss-Tie records
- Points For (PF) and Points Against (PA)
- Points For Per Game (PFPG) and Points Against Per Game (PAPG)
- Win percentage calculations
- League-wide averages and totals

## Technology Stack

### Frontend
- **React 19.1.1**: Component-based UI framework
- **Vite 7.1.2**: Fast build tool and development server
- **Tailwind CSS 3.4.18**: Utility-first CSS framework
- **Lucide React 0.552.0**: Icon library

### Backend
- **Express 5.1.0**: Web application framework
- **CORS 2.8.5**: Cross-origin resource sharing middleware
- **Body Parser 2.2.0**: Request body parsing middleware

## Project Structure

```
fantasy-football-web/
├── src/
│   ├── App.jsx                      # Main application component
│   ├── components/
│   │   ├── AllTimeTable.jsx         # All-time statistics table
│   │   ├── EditSeasonPage.jsx       # Season editing interface
│   │   ├── PlayoffBracket.jsx       # Playoff bracket visualization
│   │   ├── SeasonTable.jsx          # Season standings table
│   │   └── StatsCard.jsx            # Reusable statistics card
│   ├── index.css                    # Global styles and Tailwind imports
│   └── main.jsx                     # Application entry point
├── server.js                        # Express server configuration
├── data/
│   └── season_data.json             # League data storage
├── public/                          # Static assets
├── package.json                     # Project dependencies
├── vite.config.js                   # Vite configuration
├── tailwind.config.js               # Tailwind CSS configuration
└── postcss.config.js                # PostCSS configuration
```

## Installation

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn package manager

### Setup Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ryanw1nn/FantasyFootballWebApp.git
   cd FantasyFootballWebApp
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables** (optional):
   Create a `.env` file in the root directory:
   ```env
   VITE_API_URL=http://localhost:5001
   ```

4. **Prepare data file**:
   Ensure `data/season_data.json` exists with valid league data structure

## Usage

### Development Mode

Run the development server with hot module replacement:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Production Mode

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Start the production server**:
   ```bash
   npm start
   ```

The server will run on `http://localhost:5001`

### Preview Production Build

Test the production build locally:

```bash
npm run preview
```

## API Endpoints

The Express backend provides the following endpoints:

### Get Season Data
```
GET /api/seasons
```
Returns all season data from the JSON file.

**Response**: `200 OK`
```json
{
  "2024": [
    {
      "name": "Team Name",
      "wins": 10,
      "losses": 3,
      "ties": 1,
      "pf": 1500.5,
      "pa": 1200.3,
      "state": "active"
    }
  ]
}
```

### Update Season Data
```
POST /api/seasons
Content-Type: application/json
```
Updates the season data file with new information.

**Request Body**: Complete season data object

**Response**: `200 OK`
```json
{
  "message": "Season data updated successfully"
}
```

## Data Structure

### Season Data Format

```json
{
  "YEAR": [
    {
      "name": "string",           // Team name (required)
      "wins": "number",            // Number of wins
      "losses": "number",          // Number of losses
      "ties": "number",            // Number of ties
      "pf": "number",              // Points for
      "pa": "number",              // Points against
      "state": "string"            // Team state: 'active' | 'out' | 'eliminated'
    }
  ],
  "weeks": {
    "WEEK_NUMBER": {
      "matchups": [
        {
          "team1": "string",       // First team name or 'BYE'
          "score1": "number",      // First team score (null if not played)
          "team2": "string",       // Second team name or 'BYE'
          "score2": "number",      // Second team score (null if not played)
          "label": "string",       // Optional matchup label (e.g., "Semifinals")
          "status": "string"       // Optional status: 'active' | 'eliminated' | 'out'
        }
      ]
    }
  }
}
```

## Component Documentation

### App.jsx
Root component managing application state, view modes, and data fetching. Orchestrates all child components and handles API communication.

### AllTimeTable.jsx
Displays aggregated statistics across all seasons. Supports sorting by any metric and calculates career totals for each team.

### SeasonTable.jsx
Shows detailed standings for a single season. Calculates derived metrics like win percentage and points per game.

### EditSeasonPage.jsx
Administrative interface for modifying season data. Includes matchup editing, score updates, and team management.

### PlayoffBracket.jsx
Visual tournament bracket for playoff matchups. Supports multiple rounds and dynamic status indicators.

### StatsCard.jsx
Reusable component for displaying key statistics in a card format. Includes icon support and subtitle text.

## Configuration

### Tailwind CSS Customization

Edit `tailwind.config.js` to customize colors, spacing, and other design tokens:

```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      // Add custom configurations
    }
  }
}
```

### Vite Configuration

Modify `vite.config.js` for build optimization and plugin settings:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
})
```

## Troubleshooting

### Port Already in Use
If port 5001 is occupied, modify the port in `server.js`:
```javascript
const PORT = process.env.PORT || 5001;
```

### Data Not Loading
1. Verify `data/season_data.json` exists and contains valid JSON
2. Check console for API errors
3. Ensure backend server is running (`npm start`)

### Build Errors
1. Clear node_modules and reinstall: `rm -rf node_modules && npm install`
2. Clear Vite cache: `rm -rf .vite`
3. Verify Node.js version compatibility

### CORS Issues
Ensure the Express server has CORS enabled (already configured in `server.js`):
```javascript
app.use(cors());
```

## Development Guidelines

### Code Style
- Use functional components with hooks
- Follow React best practices for state management
- Maintain consistent formatting with Prettier (if configured)
- Use meaningful variable and function names

### Component Structure
- Keep components focused on single responsibilities
- Extract reusable logic into custom hooks
- Use PropTypes or TypeScript for type checking (if needed)

### State Management
- Use React hooks (useState, useEffect, useMemo) for local state
- Lift state up when shared between components
- Consider Context API for deeply nested prop drilling

## Performance Optimization

### Implemented Optimizations
- **useMemo**: Expensive calculations cached and recomputed only when dependencies change
- **Component Code Splitting**: React.lazy() can be added for route-based code splitting
- **Tailwind CSS Purging**: Unused styles automatically removed in production builds

### Recommendations
- Implement pagination for large season datasets
- Add debouncing to search/filter inputs
- Consider lazy loading for playoff bracket images

## Future Enhancements

Potential features for future development:
- User authentication and authorization
- Real-time updates with WebSocket integration
- Advanced analytics and data visualizations
- Mobile-responsive design improvements
- Export functionality (PDF, CSV)
- Player-level statistics tracking
- Draft history and analysis
- Trade management system

## License

ISC

## Repository

**GitHub**: [https://github.com/ryanw1nn/FantasyFootballWebApp](https://github.com/ryanw1nn/FantasyFootballWebApp)

**Issues**: [https://github.com/ryanw1nn/FantasyFootballWebApp/issues](https://github.com/ryanw1nn/FantasyFootballWebApp/issues)

## Support

For questions, issues, or feature requests, please open an issue on the GitHub repository.