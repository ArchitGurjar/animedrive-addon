// src/index.ts
import express, { Request, Response } from 'express';
import { manifest } from './manifest';
import { getRecentAnime, getAnimeDetails, getEpisodeStream } from './scraper';
import { AnimeItem } from './types';

const app = express();

// ─── CORS ──────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') res.sendStatus(200);
  else next();
});

// ─── ROOT – LANDING PAGE ─────────────────────────────────────────

app.get('/', (req: Request, res: Response) => {
  const manifestUrl = `https://${req.get('host')}/manifest.json`;
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnimeDrive Addon</title>
  <link rel="manifest" href="${manifestUrl}">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
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
      max-width: 680px;
      width: 100%;
      background: #1e293b;
      border-radius: 24px;
      padding: 40px 30px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8);
      text-align: center;
    }
    .logo {
      width: 96px; height: 96px;
      border-radius: 20px;
      background: #2d3b52;
      padding: 12px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo img { width:100%; height:100%; object-fit:contain; }
    h1 { font-size:28px; font-weight:700; margin-bottom:6px; color:#f1f5f9; }
    .badge {
      display:inline-block;
      background:#3b82f6;
      color:#fff;
      font-size:14px;
      font-weight:600;
      padding:4px 14px;
      border-radius:20px;
      margin-bottom:16px;
    }
    .description {
      font-size:16px;
      color:#94a3b8;
      margin-bottom:24px;
      line-height:1.6;
    }
    .install-section {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      background: #3b82f6;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 40px;
      text-decoration: none;
      transition: background 0.2s, transform 0.1s;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #2563eb; transform: scale(1.02); }
    .btn:active { transform: scale(0.97); }
    .btn-secondary {
      background: transparent;
      border: 1.5px solid #475569;
      color: #e2e8f0;
    }
    .btn-secondary:hover { background: #1e293b; border-color: #64748b; }
    .divider {
      border: none;
      border-top: 1px solid #334155;
      margin: 20px 0;
    }
    .manual-install {
      background: #0f172a;
      border-radius: 16px;
      padding: 20px;
      text-align: left;
      margin-bottom: 16px;
    }
    .manual-install label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    .url-box {
      display: flex;
      gap: 10px;
      align-items: center;
      background: #0b0e14;
      border-radius: 12px;
      padding: 4px 4px 4px 16px;
    }
    .url-box input {
      flex: 1;
      background: transparent;
      border: none;
      color: #e2e8f0;
      font-size: 14px;
      padding: 10px 0;
      outline: none;
      width: 100%;
    }
    .url-box input::selection { background: #3b82f6; }
    .copy-btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      padding: 8px 18px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .copy-btn:hover { background: #2563eb; }
    .copy-btn.copied { background: #22c55e; }
    .footnote {
      font-size: 14px;
      color: #64748b;
      margin-top: 12px;
    }
    .footnote a { color: #60a5fa; text-decoration:none; }
    .footnote a:hover { text-decoration:underline; }
    .ultra-note {
      background: #0f172a;
      border-radius: 12px;
      padding: 16px;
      margin-top: 16px;
      font-size: 14px;
      color: #94a3b8;
      border-left: 4px solid #3b82f6;
      text-align: left;
    }
    .ultra-note strong { color: #e2e8f0; }
    @media (max-width: 480px) {
      .card { padding: 28px 18px; }
      h1 { font-size: 24px; }
      .btn { font-size: 14px; padding: 10px 20px; }
      .url-box { flex-wrap: wrap; }
      .url-box input { font-size: 12px; }
      .copy-btn { width: 100%; text-align: center; }
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

    <!-- Install Buttons -->
    <div class="install-section">
      <a 
        href="stremio://install?url=${encodeURIComponent(manifestUrl)}"
        class="btn"
      >
        📦 Install in Stremio
      </a>
      <a 
        href="${manifestUrl}"
        class="btn btn-secondary"
        target="_blank"
      >
        📄 View Manifest
      </a>
    </div>

    <hr class="divider">

    <!-- Manual Install for UltraStream / other apps -->
    <div class="manual-install">
      <label for="manifestUrl">📱 Install in UltraStream or any Stremio‑compatible app:</label>
      <div class="url-box">
        <input type="text" id="manifestUrl" value="${manifestUrl}" readonly>
        <button class="copy-btn" id="copyBtn" onclick="copyManifest()">📋 Copy</button>
      </div>
      <p style="margin-top: 8px; font-size:13px; color:#64748b;">
        Paste this URL in the <strong>Install Custom Addon</strong> section of your app.
      </p>
    </div>

    <div class="ultra-note">
      <strong>⚡ Quick tip:</strong> If you're on <strong>UltraStream</strong>, go to <strong>Addons → Install Custom Addon</strong> and paste the URL above.
    </div>

    <hr class="divider">

    <div style="display: flex; gap: 16px; justify-content: center; font-size:14px; color:#94a3b8;">
      <a href="/health" style="color:#60a5fa;">Health</a>
      <span>•</span>
      <a href="${manifestUrl}" style="color:#60a5fa;">Manifest</a>
      <span>•</span>
      <a href="https://github.com/ArchitGurjar/animedrive-addon" target="_blank" style="color:#60a5fa;">Source</a>
    </div>
  </div>

  <script>
    function copyManifest() {
      const input = document.getElementById('manifestUrl');
      const btn = document.getElementById('copyBtn');
      input.select();
      input.setSelectionRange(0, 99999);
      try {
        navigator.clipboard.writeText(input.value);
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 Copy';
          btn.classList.remove('copied');
        }, 2500);
      } catch (e) {
        // fallback
        document.execCommand('copy');
        btn.textContent = '✅ Copied!';
        setTimeout(() => btn.textContent = '📋 Copy', 2000);
      }
    }
  </script>
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

// ─── 404 ──────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── START ────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`AnimeDrive addon running on port ${PORT}`);
});
