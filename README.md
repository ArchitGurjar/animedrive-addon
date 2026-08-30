# AnimeDrive Stremio Addon

A Node.js + Express Stremio addon that scrapes **animedrive.me** for anime content and exposes it through Stremio endpoints.

## Features

- 📺 Browse popular anime catalog
- 🔍 Get detailed anime metadata with episode lists
- 🎬 Stream video URLs for episodes
- ☁️ Deploy to Render.com (free tier)
- 🚀 TypeScript for type safety

## Project Structure

```
animedrive-addon/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
└── src/
    ├── index.ts           # Express server & routes
    ├── manifest.ts        # Manifest definition
    ├── scraper.ts         # All scraping logic
    └── types.ts           # TypeScript interfaces
```

## Endpoints

- `GET /manifest.json` – Addon metadata
- `GET /catalog/{type}/{id}.json` – List of anime (popular, movies, etc.)
- `GET /meta/{type}/{id}.json` – Details + episodes list
- `GET /stream/{type}/{id}.json` – Actual video stream URLs for a specific episode
- `GET /health` – Health check for uptime monitoring

## Prerequisites

- Node.js (v18 or later)
- Git
- GitHub account
- Render.com account (free tier)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/animedrive-addon.git
   cd animedrive-addon
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Visit http://localhost:7000/manifest.json

## Build

```bash
npm run build
npm start
```

## Deployment

### Deploy to Render.com

1. Push your code to GitHub
2. Sign up at [render.com](https://render.com)
3. Create a new Web Service
4. Connect your GitHub repository
5. Set build command: `npm install && npm run build`
6. Set start command: `npm start`
7. Deploy!

Your addon will be available at: `https://your-app-name.onrender.com`

## Adding to Stremio

1. Install Stremio desktop app
2. Go to **Addons** → **Install from URL**
3. Enter: `https://your-app-name.onrender.com/manifest.json`
4. Click Install

## Customization

The scraper uses CSS selectors that may need adjustment if animedrive.me changes its HTML structure:

- `.anime-card` – Anime card container
- `.title` – Anime title
- `.anime-poster` – Poster image
- `.episode-list` – Episode list container
- `video source` – Video stream source

Inspect the site and update selectors in `src/scraper.ts` as needed.

## License

MIT
