// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// ─── CONFIGURATION ────────────────────────────────────────────────

const BASE_URL = 'https://animedrive.me';

// Optional: use ScraperAPI or similar to bypass Cloudflare
// Set the environment variable SCRAPER_API_KEY to enable it.
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ─── HELPER: FETCH HTML ───────────────────────────────────────────

async function fetchHTML(url: string): Promise<string> {
  try {
    // If a ScraperAPI key is provided, route through it.
    let finalUrl = url;
    if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
      finalUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
    }

    const response = await axios.get(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': BASE_URL,
      },
      timeout: 20000,
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    throw new Error(`Failed to fetch: ${url}`);
  }
}

// ─── CATALOG: Get list of anime from homepage ────────────────────

export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  // WordPress uses ?paged=N for pagination
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const items: AnimeItem[] = [];

  // Each anime post is an <article class="post">
  $('article.post').each((_, element) => {
    const titleElement = $(element).find('h2.entry-title a');
    const title = titleElement.text().trim();
    const link = titleElement.attr('href');
    const poster = $(element).find('div.post-thumb-img-content img').attr('src');

    // Extract language badges (optional, but could be used for filtering)
    // const langs = $(element).find('div.animedrive-lang-badges span.lang-badge')
    //   .map((_, el) => $(el).text().trim()).get();

    // Extract category from class, e.g., category-action
    // const categories: string[] = [];
    // $(element).attr('class')?.split(' ').forEach(cls => {
    //   if (cls.startsWith('category-')) categories.push(cls.replace('category-', ''));
    // });

    if (title && link) {
      // Generate a unique ID from the slug
      const id = link.split('/').filter(Boolean).pop() || link;
      items.push({
        id,
        name: title,
        poster: poster || undefined,
        type: 'series', // we'll refine in meta if needed
      });
    }
  });

  return items;
}

// ─── META: Get detailed info + episodes for a specific anime ─────

export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  // The detail page URL is: https://animedrive.me/{animeId}/
  const url = `${BASE_URL}/${animeId}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── Title ──
  // Could be in h1.entry-title or .entry-header h1
  const title = $('h1.entry-title, .entry-header h1, .anime-title').first().text().trim();
  if (!title) {
    console.warn(`Could not find title for anime: ${animeId}`);
    return null;
  }

  // ── Poster ──
  const poster = $('.post-thumb-img-content img, .anime-poster img, .featured-image img').first().attr('src');

  // ── Description ──
  const description = $('.entry-content p, .anime-description, .post-content p').first().text().trim();

  // ── Genres ──
  const genre: string[] = [];
  // Look for categories links (often in .category a or .genres a)
  $('.category a, .genres a, .post-categories a').each((_, element) => {
    const text = $(element).text().trim();
    if (text) genre.push(text);
  });
  // Alternatively, extract from category class on the article (if needed)

  // ── Episodes ──
  const episodes: Episode[] = [];

  // Common episode containers on AnimeDrive:
  // - #episode_related li
  // - .episode-list li
  // - .download-links li
  // We'll combine multiple selectors.
  const episodeSelectors = '#episode_related li, .episode-list li, .download-links li, .episodes li';
  $(episodeSelectors).each((_, element) => {
    const linkElement = $(element).find('a');
    const href = linkElement.attr('href');
    const epText = linkElement.text().trim();

    if (href && epText) {
      // Try to extract season and episode numbers
      let season = 1;
      let episodeNum = 1;

      // Patterns: "Episode 12", "S1E12", "Season 1 Episode 12"
      const seasonMatch = epText.match(/Season\s*(\d+)/i) || href.match(/season[-\s]*(\d+)/i);
      const episodeMatch = epText.match(/Episode\s*(\d+)/i) || href.match(/episode[-\s]*(\d+)/i) || epText.match(/\b(\d{1,3})\b/);

      if (seasonMatch) season = parseInt(seasonMatch[1], 10);
      if (episodeMatch) episodeNum = parseInt(episodeMatch[1], 10);

      // Generate an ID from the href (e.g., the last part)
      const id = href.split('/').filter(Boolean).pop() || href;

      episodes.push({
        season,
        episode: episodeNum,
        title: epText || `Episode ${episodeNum}`,
        id,
      });
    }
  });

  // If no episodes found, try a broader search – links containing "watch"
  if (episodes.length === 0) {
    $('a[href*="watch"], a[href*="episode"]').each((_, element) => {
      const href = $(element).attr('href');
      const epText = $(element).text().trim();
      if (href && epText) {
        const id = href.split('/').filter(Boolean).pop() || href;
        episodes.push({
          season: 1,
          episode: episodes.length + 1,
          title: epText || `Episode ${episodes.length + 1}`,
          id,
        });
      }
    });
  }

  return {
    id: animeId,
    name: title,
    poster: poster || undefined,
    type: 'series',
    description,
    genre,
    episodes,
  };
}

// ─── STREAM: Get the video URL for a specific episode ────────────

export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  // The watch page URL is usually: https://animedrive.me/watch/{episodeId}/
  // or simply https://animedrive.me/{episodeId}/
  // We'll try both.
  let html: string;
  let url = `${BASE_URL}/watch/${episodeId}/`;
  try {
    html = await fetchHTML(url);
  } catch {
    // Fallback: try without /watch/
    url = `${BASE_URL}/${episodeId}/`;
    html = await fetchHTML(url);
  }

  const $ = cheerio.load(html);

  // Look for an iframe that contains the video player.
  // Common selectors: .play-video iframe, .video-container iframe, #player iframe
  const iframeSrc = $('iframe[src*="player"], iframe[src*="embed"], .play-video iframe, .video-container iframe, #player iframe').first().attr('src');

  if (iframeSrc) {
    if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
    if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
    return iframeSrc;
  }

  // Fallback: look for a <video> element's source
  const videoSrc = $('video source').first().attr('src');
  if (videoSrc) return videoSrc;

  // Some sites embed the video via JavaScript; we could attempt to parse scripts,
  // but for simplicity we return null.
  console.warn(`Could not find stream for episode: ${episodeId}`);
  return null;
}
