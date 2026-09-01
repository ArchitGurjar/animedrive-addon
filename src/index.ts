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
  <title>DesiDubAnime Scraper</title>
  <style>
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
      <a href="stremio://install?url=${encodeURIComponent(manifestUrl)}" class="btn">📦 Install in Stremio</a>
      <a href="${manifestUrl}" class="btn btn-secondary" target="_blank">📄 View Manifest</a>
    </div>
    <div style="text-align:left; margin-top:12px;">
      <label style="font-size:14px; color:#94a3b8;">📱 Install in UltraStream:</label>
      <div class="url-box">
        <input type="text" id="manifestUrl" value="${manifestUrl}" readonly>
        <button class="copy-btn" id="copyBtn" onclick="copyManifest()">📋 Copy</button>
      </div>
    </div>
    <p class="footnote"><a href="/health" style="color:#60a5fa;">Health</a> • <a href="${manifestUrl}" style="color:#60a5fa;">Manifest</a> • <a href="https://github.com/your-username/desidubanime-addon" style="color:#60a5fa;">Source</a></p>
  </div>
  <script>
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

// ─── API ROUTES ────────────────────────────────────────────────────

app.get('/manifest.json', (req: Request, res: Response) => {
  res.json(manifest);
});

app.get('/catalog/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    let items: AnimeItem[] = [];
    if (id === 'desidubanime_popular' && type === 'series') {
      const page = parseInt(req.query.page as string) || 1;
      items = await getRecentAnime(page);
    } else if (id === 'desidubanime_movies' && type === 'movie') {
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
          title: 'DesiDubAnime Stream',
        },
      ],
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`DesiDubAnime addon running on port ${PORT}`);
});
