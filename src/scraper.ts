import axios from 'axios';
import cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

const BASE_URL = 'https://animedrive.me';

// Helper to fetch HTML with headers
async function fetchHTML(url: string): Promise<string> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 10000,
  });
  return response.data;
}

// Get popular anime list (used for catalog)
export async function getPopularAnime(): Promise<AnimeItem[]> {
  const html = await fetchHTML(`${BASE_URL}/popular`);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // Example selector – adjust to actual site structure
  $('.anime-card').each((_, el) => {
    const title = $(el).find('.title').text().trim();
    const link = $(el).find('a').attr('href');
    const poster = $(el).find('img').attr('src');
    if (title && link) {
      const id = link.replace('/anime/', '').replace('/', '');
      items.push({
        id,
        name: title,
        poster: poster ? `${BASE_URL}${poster}` : undefined,
        type: 'series',
      });
    }
  });
  return items;
}

// Get anime details + episodes
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const html = await fetchHTML(`${BASE_URL}/anime/${animeId}`);
  const $ = cheerio.load(html);

  const title = $('h1.anime-title').text().trim();
  if (!title) return null;

  const poster = $('.anime-poster img').attr('src');
  const description = $('.anime-description').text().trim();
  const genre = $('.genres a').map((_, el) => $(el).text().trim()).get();

  // Extract episodes – example: each episode link is like /watch/123
  const episodes: Episode[] = [];
  $('.episode-list a').each((_, el) => {
    const href = $(el).attr('href');
    const epText = $(el).text().trim();
    if (href && epText) {
      // parse season and episode numbers from text or href
      // assuming format "Season 1 Episode 12"
      const seasonMatch = epText.match(/Season\s*(\d+)/i);
      const episodeMatch = epText.match(/Episode\s*(\d+)/i);
      const season = seasonMatch ? parseInt(seasonMatch[1]) : 1;
      const episode = episodeMatch ? parseInt(episodeMatch[1]) : 1;
      const id = href.replace('/watch/', '').replace('/', '');
      episodes.push({
        season,
        episode,
        title: epText,
        id,
      });
    }
  });

  return {
    id: animeId,
    name: title,
    poster: poster ? `${BASE_URL}${poster}` : undefined,
    type: 'series',
    description,
    genre,
    episodes,
  };
}

// Get video stream URL for a specific episode
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  const html = await fetchHTML(`${BASE_URL}/watch/${episodeId}`);
  const $ = cheerio.load(html);

  // Typical: video player iframe or source tag
  // Look for iframe src, or video source
  const iframeSrc = $('iframe.player-iframe').attr('src');
  if (iframeSrc) {
    // Sometimes the iframe loads a player that embeds the video; we may need to follow redirects.
    return iframeSrc;
  }

  // Or direct video source
  const videoSrc = $('video source').attr('src');
  if (videoSrc) {
    return videoSrc;
  }

  // If video is embedded via JavaScript, we may need to extract from script tags.
  // For this example, we'll return null and let user adapt.
  return null;
}
