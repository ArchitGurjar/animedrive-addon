// src/index.ts
// ────────────────────────────────────────────────────────────────────────────────
//  IMPORTS
// ────────────────────────────────────────────────────────────────────────────────

// Express – the web framework for handling HTTP requests and routing.
import express, { Request, Response } from 'express';

// Manifest – contains the addon's metadata (id, name, resources, catalogs, etc.)
// Stremio/UltraStream fetch this to understand what your addon offers.
import { manifest } from './manifest';

// Scraper functions – all the business logic for fetching data from desidubanime.me.
//   - getRecentAnime:   returns a list of anime (used for backward compatibility)
//   - getAllAnime:      returns the FULL catalog from the A‑Z list (recommended)
//   - getAnimeDetails:  returns detailed info + episodes for a specific anime
//   - getEpisodeStream: returns the video URL (iframe) for a specific episode
import { getRecentAnime, getAllAnime, getAnimeDetails, getEpisodeStream } from './scraper';

// Type definition for the catalog items (used for type safety in the catalog route).
import { AnimeItem } from './types';

// ────────────────────────────────────────────────────────────────────────────────
//  EXPRESS APP INITIALISATION
// ────────────────────────────────────────────────────────────────────────────────

// Create the Express application instance.
// This is the core object that handles all HTTP methods (GET, POST, etc.)
const app = express();

// ────────────────────────────────────────────────────────────────────────────────
//  CORS MIDDLEWARE
// ────────────────────────────────────────────────────────────────────────────────
// Cross‑Origin Resource Sharing is required because Stremio/UltraStream
// (which run on different origins) will call your addon's endpoints.
// Without CORS, browsers would block the requests.
// ────────────────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  // Allow any origin to access this addon (wildcard).
  // In production, you could restrict to specific domains if needed.
  res.header('Access-Control-Allow-Origin', '*');

  // Allow specific HTTP headers that the client might send.
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  // Handle preflight (OPTIONS) requests – respond with 200 OK.
  // This is part of the CORS protocol; browsers send OPTIONS before the actual request.
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    // For all other methods, continue to the next middleware/route handler.
    next();
  }
});

// ────────────────────────────────────────────────────────────────────────────────
//  ROOT ENDPOINT – LANDING PAGE
// ────────────────────────────────────────────────────────────────────────────────
// This is the user‑friendly homepage of your addon.
// It displays the manifest URL and provides buttons to install in Stremio
// or copy the URL for UltraStream.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/', (req: Request, res: Response) => {
  // Dynamically construct the manifest URL using the host header.
  // This ensures the URL works correctly on Render, localhost, or any other domain.
  const manifestUrl = `https://${req.get('host')}/manifest.json`;

  // Send an HTML page with a clean, dark‑themed UI.
  // The page includes:
  //   - A "Install in Stremio" button that uses the stremio://install?url=... scheme.
  //   - A "View Manifest" link to inspect the JSON.
  //   - A copyable input field for UltraStream users.
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DesiDubAnime Scraper</title>
  <style>
    /* Reset & base styling */
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: system-ui, sans-serif; background: #0b0e14; color: #e2e8f0; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .card { max-width: 600px; width: 100%; background: #1e293b; border-radius: 24px; padding: 40px 30px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); }
    h1 { font-size: 28px; margin-bottom: 8px; color: #f1f5f9; }
    .badge { display: inline-block; background: #3b82f6; color: #fff; font-size: 14px; padding: 4px 14px; border-radius: 20px; margin-bottom: 16px; }
    .description { font-size: 16px; color: #94a3b8; margin-bottom: 24px; line-height: 1.6; }
    .install-section { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-bottom: 20px; }
    .btn { display: inline-block; background: #3b82f6; color: #fff; font-size: 16px; font-weight: 600; padding: 12px 28px; border-radius: 40px; text-decoration: none; transition: background 0.2s; border: none; cursor: pointer; }
    .btn:hover { background: #2563eb; }
    .btn-secondary { background: transparent; border: 1.5px solid #475569; color: #e2e8f0; }
    .btn-secondary:hover { background: #1e293b; }
    .url-box { display: flex; gap: 10px; align-items: center; background: #0f172a; border-radius: 12px; padding: 4px 4px 4px 16px; margin-top: 8px; }
    .url-box input { flex: 1; background: transparent; border: none; color: #e2e8f0; font-size: 14px; padding: 10px 0; outline: none; }
    .copy-btn { background: #3b82f6; color: #fff; border: none; padding: 8px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .copy-btn:hover { background: #2563eb; }
    .copy-btn.copied { background: #22c55e; }
    .footnote { font-size: 14px; color: #64748b; margin-top: 16px; }
    @media (max-width: 480px) { .card { padding: 28px 18px; } h1 { font-size: 24px; } .url-box { flex-wrap: wrap; } .copy-btn { width: 100%; } }
  </style>
</head>
<body>
  <div class="card">
    <h1>DesiDubAnime Scraper</h1>
    <span class="badge">v1.0.0</span>
    <p class="description">Watch Indian regional dubbed anime from <strong>desidubanime.me</strong></p>
    <div class="install-section">
      <!-- Stremio installation link (uses the stremio:// scheme) -->
      <a href="stremio://install?url=${encodeURIComponent(manifestUrl)}" class="btn">📦 Install in Stremio</a>
      <!-- Direct link to view the JSON manifest -->
      <a href="${manifestUrl}" class="btn btn-secondary" target="_blank">📄 View Manifest</a>
    </div>
    <div style="text-align:left; margin-top:12px;">
      <label style="font-size:14px; color:#94a3b8;">📱 Install in UltraStream:</label>
      <div class="url-box">
        <input type="text" id="manifestUrl" value="${manifestUrl}" readonly>
        <button class="copy-btn" id="copyBtn" onclick="copyManifest()">📋 Copy</button>
      </div>
    </div>
    <p class="footnote">
      <a href="/health" style="color:#60a5fa;">Health</a> •
      <a href="${manifestUrl}" style="color:#60a5fa;">Manifest</a> •
      <a href="https://github.com/your-username/desidubanime-addon" style="color:#60a5fa;">Source</a>
    </p>
  </div>
  <script>
    // Simple JavaScript to copy the manifest URL to the clipboard.
    function copyManifest() {
      const input = document.getElementById('manifestUrl');
      const btn = document.getElementById('copyBtn');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2500);
      });
    }
  </script>
</body>
</html>
  `);
});

// ────────────────────────────────────────────────────────────────────────────────
//  MANIFEST ENDPOINT
// ────────────────────────────────────────────────────────────────────────────────
// Stremio/UltraStream will first fetch this JSON file to learn about your addon:
//   - name, description, version
//   - what resources it provides (catalog, meta, stream)
//   - which catalogs are available (e.g., "desidubanime_all")
// The manifest object is imported from './manifest.ts'.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/manifest.json', (req: Request, res: Response) => {
  res.json(manifest);
});

// ────────────────────────────────────────────────────────────────────────────────
//  CATALOG ENDPOINT
// ────────────────────────────────────────────────────────────────────────────────
// URL pattern: /catalog/:type/:id.json
//   - type:    'series' or 'movie' (we support 'series' only for now)
//   - id:      the catalog identifier (e.g., 'desidubanime_all')
// Optional query parameter: ?page=N (for pagination – not used here because we return everything)
// Returns a JSON array of "metas" – each containing id, type, name, poster.
// Stremio uses this to display a list of anime posters in the UI.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/catalog/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;

  try {
    let items: AnimeItem[] = [];

    // Check which catalog is requested.
    // We have two catalogs: 'desidubanime_all' (full A‑Z list) and 'desidubanime_popular' (optional fallback).
    if (id === 'desidubanime_all' && type === 'series') {
      // Fetch the complete catalog from the A‑Z list.
      items = await getAllAnime();
    } else if (id === 'desidubanime_popular' && type === 'series') {
      // For backward compatibility, we also support the 'popular' catalog.
      // getRecentAnime() now returns the full list as well (see scraper.ts).
      items = await getRecentAnime();
    } else {
      // If the catalog ID doesn't match any known one, return an empty array.
      // This avoids errors and keeps the response valid.
      items = [];
    }

    // Transform the internal AnimeItem format into the Stremio meta format.
    const metas = items.map(item => ({
      id: item.id,          // unique slug (used later in /meta and /stream)
      type: item.type,      // 'series' (or 'movie' in future)
      name: item.name,      // the anime title (e.g., "Demon Slayer")
      poster: item.poster,  // URL of the poster image
    }));

    // Send the response. Stremio expects an object with a "metas" array.
    res.json({ metas });
  } catch (error) {
    // If anything fails (network error, parser crash, etc.), log the error
    // and return a 500 Internal Server Error with a user‑friendly message.
    console.error('Catalog error:', error);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
//  META ENDPOINT
// ────────────────────────────────────────────────────────────────────────────────
// URL pattern: /meta/:type/:id.json
//   - type:    'series' or 'movie'
//   - id:      the anime slug (e.g., 'demon-slayer-season-3')
// Returns detailed information about a single anime, including the list of episodes.
// Stremio uses this when a user clicks on a poster to show the episode list.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/meta/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;

  try {
    // Fetch the anime details (title, poster, description, genres, episodes)
    const details = await getAnimeDetails(id);

    // If no details are found (e.g., the anime doesn't exist), return 404.
    if (!details) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    // Build the meta object in the format Stremio expects.
    const meta = {
      id: details.id,
      type: details.type,
      name: details.name,
      poster: details.poster,
      description: details.description,
      genre: details.genre,
      // videos: an array of episodes, each with season, episode number, title, and id.
      // The 'id' field is crucial – it's used in the /stream endpoint to fetch the video.
      videos: details.episodes.map(ep => ({
        season: ep.season,
        episode: ep.episode,
        title: ep.title,
        id: ep.id,   // example: 'kimetsu-no-yaiba-katanakaji-no-sato-hen-season-3-episode-1'
      })),
    };

    // Send the response.
    res.json({ meta });
  } catch (error) {
    console.error('Meta error:', error);
    res.status(500).json({ error: 'Failed to fetch meta' });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
//  STREAM ENDPOINT
// ────────────────────────────────────────────────────────────────────────────────
// URL pattern: /stream/:type/:id.json
//   - type:    'series' or 'movie' (ignored; kept for Stremio compatibility)
//   - id:      the episode slug (e.g., 'kimetsu-no-yaiba-katanakaji-no-sato-hen-season-3-episode-1')
// Returns a stream URL that Stremio/UltraStream will play.
// The response is a JSON object with a "streams" array containing at least one entry.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/stream/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;

  try {
    // Get the stream URL (iframe or direct video) from the episode page.
    const streamUrl = await getEpisodeStream(id);

    // If no stream is found, return 404.
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    // Build the response. Stremio allows multiple streams, but we only provide one.
    res.json({
      streams: [
        {
          url: streamUrl,               // the actual video URL (e.g., https://gdmirrorbot.nl/embed/...)
          title: 'DesiDubAnime Stream', // a descriptive title shown in the player
        },
      ],
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
//  HEALTH CHECK ENDPOINT
// ────────────────────────────────────────────────────────────────────────────────
// A simple endpoint that returns "OK".
// Used by uptime monitoring services (e.g., UptimeRobot, cron-job.org) to
// keep the Render free tier from sleeping. Render's free instances go to sleep
// after 15 minutes of inactivity; pinging /health every 10–14 minutes prevents that.
// ────────────────────────────────────────────────────────────────────────────────

app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

// ────────────────────────────────────────────────────────────────────────────────
//  404 CATCH‑ALL
// ────────────────────────────────────────────────────────────────────────────────
// If the request doesn't match any of the above routes, return a 404 JSON error.
// This is good practice to avoid exposing internal errors or serving unintended content.
// ────────────────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ────────────────────────────────────────────────────────────────────────────────
//  START THE SERVER
// ────────────────────────────────────────────────────────────────────────────────
// The server listens on the port specified by the environment variable PORT.
// Render automatically sets PORT (e.g., 10000). For local development, we fall back to 7000.
// Once the server starts, a log message is printed to the console.
// ────────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;

app.listen(PORT, () => {
  console.log(`✅ DesiDubAnime addon running on port ${PORT}`);
});
