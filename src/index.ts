import express, { Request, Response } from 'express';
import { manifest } from './manifest';
import { getPopularAnime, getAnimeDetails, getEpisodeStream } from './scraper';
import { AnimeItem } from './types';

const app = express();

// Addon manifest endpoint
app.get('/manifest.json', (req: Request, res: Response) => {
  res.json(manifest);
});

// Catalog endpoint
app.get('/catalog/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    let items: AnimeItem[] = [];
    if (id === 'animedrive_popular' && type === 'series') {
      items = await getPopularAnime();
    } else if (id === 'animedrive_movies' && type === 'movie') {
      // implement getPopularMovies() if needed
      items = [];
    }
    // Convert to Stremio catalog format
    const metas = items.map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      year: item.year,
    }));
    res.json({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// Meta endpoint
app.get('/meta/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    const details = await getAnimeDetails(id);
    if (!details) {
      return res.status(404).json({ error: 'Anime not found' });
    }
    // Convert to Stremio meta format
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

// Stream endpoint
app.get('/stream/:type/:id.json', async (req: Request, res: Response) => {
  const { type, id } = req.params;
  try {
    const streamUrl = await getEpisodeStream(id);
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    // Stremio expects an array of streams
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

// Health check for Render uptime
app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

// Start server
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`AnimeDrive addon running on port ${PORT}`);
});
