// src/index.ts
import express, { Request, Response } from 'express';
import { manifest } from './manifest'; // Ensure manifest.ts exports it correctly
import { getRecentAnime, getAnimeDetails, getEpisodeStream } from './scraper';
import { AnimeItem } from './types';

const app = express();

// Addon manifest endpoint
app.get('/manifest.json', (req: Request, res: Response) => {
  res.json(manifest);
});

// Catalog endpoint – now using Gogoanime's "recent" catalog
app.get('/catalog/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    let items: AnimeItem[] = [];
    // Match the catalog ID you defined in manifest.ts (e.g., "gogoanime_recent")
    if (id === 'gogoanime_recent' && type === 'series') {
      items = await getRecentAnime();
    } else if (id === 'gogoanime_movies' && type === 'movie') {
      // You can implement getRecentMovies() later if needed
      items = [];
    }
    const metas = items.map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      // year is optional; you can add it if you extract it
    }));
    res.json({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// Meta endpoint – unchanged, uses getAnimeDetails
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

// Stream endpoint – uses getEpisodeStream
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
          title: 'Gogoanime Stream',
        },
      ],
    });
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Failed to fetch stream' });
  }
});

// Health check for Render
app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`AnimeDrive addon running on port ${PORT}`);
});
