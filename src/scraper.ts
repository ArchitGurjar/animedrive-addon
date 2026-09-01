// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

const BASE_URL = 'https://www.desidubanime.me';
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

async function fetchHTML(url: string): Promise<string> {
  try {
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

function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

async function followRedirect(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { maxRedirects: 5 });
    return response.request.res.responseUrl || url;
  } catch { return url; }
}

// ─── CATALOG ────────────────────────────────────────────────────────

export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // Multiple selectors for different sections (Most Popular, grid, etc.)
  const selectors = [
    '.flex.gap-5.border-b',
    '.grid .relative',
    '.anime-card',
    '.post-item',
    '.movie-item'
  ];

  let found = false;
  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length) {
      elements.each((_, el) => {
        const titleEl = $(el).find('a, .title, h3, .anime-title, .font-medium a').first();
        const title = titleEl.text().trim() || $(el).find('img').attr('alt') || '';
        const link = titleEl.attr('href') || $(el).find('a').attr('href') || '';
        const poster = $(el).find('img').attr('src') || '';
        if (title && link) {
          const slug = extractSlug(link);
          items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
        }
      });
      found = true;
      break;
    }
  }

  if (!found) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;
      const title = $(el).text().trim() || $(el).find('img').attr('alt') || '';
      const poster = $(el).find('img').attr('src') || '';
      if (title && link.includes('/anime/')) {
        const slug = extractSlug(link);
        items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
      }
    });
  }

  // Remove duplicates
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

// ─── META ──────────────────────────────────────────────────────────

export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // Title
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    return null;
  }

  // Poster
  const poster = $('.anime-featured img, .poster img, .anime-poster img').first().attr('src');

  // Description
  const description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim();

  // Genres
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a, .tags a').each((_, el) => {
    const t = $(el).text().trim();
    if (t) genre.push(t);
  });

  // ─── Episodes ───
  const episodes: Episode[] = [];

  // Primary selector: episode list items
  $('.episode-list-display-box a.episode-list-item').each((_, el) => {
    const href = $(el).attr('href');
    const epNum = $(el).find('.episode-list-item-number').text().trim();
    const epTitle = $(el).find('.episode-list-item-title').text().trim();
    if (href && epNum) {
      const num = parseInt(epNum, 10);
      const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
      episodes.push({
        season: 1,
        episode: num,
        title: epTitle || `Episode ${num}`,
        id: id,
      });
    }
  });

  // Fallback: any link containing "/watch/"
  if (episodes.length === 0) {
    $('a[href*="/watch/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = $(el).text().trim();
      const match = text.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
        episodes.push({
          season: 1,
          episode: num,
          title: text || `Episode ${num}`,
          id: id,
        });
      }
    });
  }

  console.log(`[Meta] Found ${episodes.length} episodes for ${animeId}`);

  return {
    id: animeId,
    name: title,
    poster: poster || undefined,
    type: 'series',
    description: description || 'No description available.',
    genre,
    episodes,
  };
}

// ─── STREAM ────────────────────────────────────────────────────────

export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  const url = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching: ${url}`);
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    // Primary: iframe inside .episode-player-box
    let iframeSrc = $('.episode-player-box iframe').first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

    // Fallback: any iframe
    iframeSrc = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

    // Video source
    const videoSrc = $('video source').first().attr('src') || $('video').first().attr('src');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `${BASE_URL}${videoSrc}`;
      return videoSrc;
    }

    console.warn(`[Stream] No video found for ${episodeId}`);
    return null;
  } catch (error) {
    console.error(`[Stream] Error fetching ${url}:`, error);
    return null;
  }
}
