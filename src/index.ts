// src/index.ts
import express, { Request, Response } from 'express';
import { manifest } from './manifest';
import { getRecentAnime, getAnimeDetails, getEpisodeStream } from './scraper';
import { AnimeItem } from './types';

const app = express();

// ─── CORS MIDDLEWARE ──────────────────────────────────────────────
// This allows Stremio and UltraStream to access the addon
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// ─── ROOT – LANDING PAGE ─────────────────────────────────────────

app.get('/', (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnimeDrive Addon</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: #0b0e14;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .card {
      max-width: 600px;
      width: 100%;
      background: #1e293b;
      border-radius: 24px;
      padding: 40px 30px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      text-align: center;
    }
    .logo {
      width: 96px;
      height: 96px;
      border-radius: 20px;
      background: #2d3b52;
      padding: 12px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #f1f5f9;
    }
    .badge {
      display: inline-block;
      background: #3b82f6;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 16px;
      letter-spacing: 0.3px;
    }
    .description {
      font-size: 16px;
      color: #94a3b8;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .install-btn {
      display: inline-block;
      background: #3b82f6;
      color: #fff;
      font-size: 18px;
      font-weight: 600;
      padding: 14px 36px;
      border-radius: 40px;
      text-decoration: none;
      transition: background 0.2s, transform 0.1s;
      margin-bottom: 28px;
      border: none;
      cursor: pointer;
    }
    .install-btn:hover {
      background: #2563eb;
      transform: scale(1.02);
    }
    .install-btn:active {
      transform: scale(0.97);
    }
    .divider {
      border: none;
      border-top: 1px solid #334155;
      margin: 20px 0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      text-align: left;
      margin-bottom: 20px;
    }
    .info-item {
      background: #0f172a;
      padding: 12px 16px;
      border-radius: 12px;
    }
    .info-item .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .info-item .value {
      font-size: 15px;
      font-weight: 500;
      color: #e2e8f0;
      margin-top: 2px;
    }
    .footnote {
      font-size: 14px;
      color: #64748b;
      margin-top: 16px;
    }
    .footnote a {
      color: #60a5fa;
      text-decoration: none;
    }
    .footnote a:hover {
      text-decoration: underline;
    }
    .ultrastream-note {
      background: #0f172a;
      border-radius: 12px;
      padding: 16px;
      margin-top: 16px;
      font-size: 14px;
      color: #94a3b8;
      border-left: 4px solid #3b82f6;
    }
    .ultrastream-note strong {
      color: #e2e8f0;
    }
    @media (max-width: 480px) {
      .card { padding: 28px 18px; }
      h1 { font-size: 24px; }
      .install-btn { font-size: 16px; padding: 12px 28px; }
      .info-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <img src="https://animedrive.me/wp-content/uploads/2026/07/animedrive-logo-fixed.png" alt="AnimeDrive">
    </div>

    <h1>AnimeDrive Scraper</h1>
    <span class="badge">v1.0.0</span>

    <p class="description">
      Watch &amp; download anime from <strong>animedrive.me</strong> – Hindi, English, Japanese &amp; multi‑audio.
    </p>

    <!-- Install in Stremio -->
    <a 
      href="stremio://install?url=https%3A%2F%2Fanimedrive-addon.onrender.com%2Fmanifest.json"
      class="install-btn"
    >
      📦 Install in Stremio
    </a>

    <hr class="divider">

    <div class="info-grid">
      <div class="info-item">
        <div class="label">Manifest</div>
        <div class="value"><a href="/manifest.json" style="color:#60a5fa;">/manifest.json</a></div>
      </div>
      <div class="info-item">
        <div class="label">Health</div>
        <div class="value"><a href="/health" style="color:#60a5fa;">/health</a></div>
      </div>
      <div class="info-item">
        <div class="label">Resources</div>
        <div class="value">catalog, meta, stream</div>
      </div>
      <div class="info-item">
        <div class="label">Types</div>
        <div class="value">series, movie</div>
      </div>
    </div>

    <div class="ultrastream-note">
      <strong>📱 UltraStream Users</strong><br>
      Open the app, go to <strong>Addons → Install Custom Addon</strong><br>
      and paste:<br>
      <code style="word-break:break-all; background:#1e293b; padding:4px 8px; border-radius:6px; display:inline-block; margin-top:6px;">
        https://animedrive-addon.onrender.com/manifest.json
      </code>
    </div>

    <p class="footnote">
      🔐 <a href="https://github.com/ArchitGurjar/animedrive-addon" target="_blank">View Source</a>
    </p>
  </div>
</body>
</html>
  `);
});

// ─── MANIFEST ──────────────────────────────────────────────────────

app.get('/manifest.json', (req: Request, res: Response) => {
  res.json(manifest);
});

// ─── CATALOG ──────────────────────────────────────────────────────

app.get('/catalog/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    let items: AnimeItem[] = [];
    if (id === 'animedrive_popular' && type === 'series') {
      const page = parseInt(req.query.page as string) || 1;
      items = await getRecentAnime(page);
    } else if (id === 'animedrive_movies' && type === 'movie') {
      // Future: implement movie catalog
      items = [];
    }

    const metas = items.map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
    }));

    res.json({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// ─── META ─────────────────────────────────────────────────────────

app.get('/meta/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    const details = await getAnimeDetails(id);
    if (!details) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    const meta = {
      id: details.id,
      type: details.type,
      name: details.name,
      poster: details.poster,
      description: details.description,
      genre: details.genre,
      videos: details.episodes.map(ep => ({
        season: ep.season,
        episode: ep.episode,
        title: ep.title,
        id: ep.id,
      })),
    };

    res.json({ meta });
  } catch (error) {
    console.error('Meta error:', error);
    res.status(500).json({ error: 'Failed to fetch meta' });
  }
});

// ─── STREAM ───────────────────────────────────────────────────────

app.get('/stream/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    const streamUrl = await getEpisodeStream(id);
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    res.json({
      streams: [
        {
          url: streamUrl,
          title: 'AnimeDrive Stream',
        },
      ],
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

// ─── HEALTH ───────────────────────────────────────────────────────

app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

// ─── 404 CATCH‑ALL ──────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── START SERVER ────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`AnimeDrive addon running on port ${PORT}`);
});
