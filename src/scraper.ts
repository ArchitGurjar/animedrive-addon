// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// ─── CONFIGURATION ───────────────────────────────────────────────────

const BASE_URL = 'https://www.desidubanime.me';

// Optional ScraperAPI key (to bypass Cloudflare if needed)
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ─── HELPERS ────────────────────────────────────────────────────────

/**
 * Fetch HTML from a URL, optionally via ScraperAPI.
 */
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

/**
 * Extract anime slug from URL.
 * Example: "https://www.desidubanime.me/anime/slug/" -> "slug"
 */
function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

/**
 * Follow redirects to get the final URL.
 */
async function followRedirect(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    return response.request.res.responseUrl || url;
  } catch (error) {
    console.warn(`Redirect following failed for ${url}:`, error);
    return url;
  }
}

// ─── CATALOG ────────────────────────────────────────────────────────

/**
 * Get list of anime from the homepage.
 * Scrapes "Popular Anime", "Top Airing", "Most Popular" sections.
 */
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  // DesiDubAnime uses pagination like /page/2/ or ?page=2
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const items: AnimeItem[] = [];

  // Looking for anime cards - adjust selectors based on actual HTML
  // Try multiple possible selectors
  const cardSelectors = [
    '.anime-card',
    '.anime-item',
    '.post-item',
    '.movie-item',
    '.anime-grid .item',
    '.anime-list .anime',
    '.anime-poster',
    '.entry-content .anime'
  ];

  let found = false;
  for (const selector of cardSelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, element) => {
        const titleElement = $(element).find('a, .title, h3, .anime-title').first();
        const title = titleElement.text().trim() || $(element).find('img').attr('alt') || '';
        const link = titleElement.attr('href') || $(element).find('a').attr('href') || '';
        const poster = $(element).find('img').attr('src') || $(element).find('img').attr('data-src') || '';

        if (title && link) {
          const slug = extractSlug(link);
          items.push({
            id: slug,
            name: title,
            poster: poster || undefined,
            type: 'series',
          });
        }
      });
      found = true;
      break;
    }
  }

  // Fallback: look for any link with /anime/ in href
  if (!found) {
    $('a[href*="/anime/"]').each((_, element) => {
      const link = $(element).attr('href');
      if (!link) return;
      const title = $(element).text().trim() || $(element).find('img').attr('alt') || '';
      const poster = $(element).find('img').attr('src') || '';
      if (title && link && link.includes('/anime/')) {
        const slug = extractSlug(link);
        items.push({
          id: slug,
          name: title,
          poster: poster || undefined,
          type: 'series',
        });
      }
    });
  }

  // Remove duplicates
  const uniqueItems = Array.from(
    new Map(items.map(item => [item.id, item])).values()
  );

  return uniqueItems;
}

// ─── META ──────────────────────────────────────────────────────────

/**
 * Get detailed info + episodes for a specific anime.
 * Uses the anime ID (slug) to fetch the detail page.
 */
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── Extract Title ──
  let title = $('h1.entry-title').first().text().trim();
  if (!title) {
    title = $('.anime-title, .post-title, .entry-header h1').first().text().trim();
  }
  if (!title) {
    console.warn(`Could not find title for anime: ${animeId}`);
    return null;
  }

  // ── Extract Poster ──
  let poster = $('.poster img, .anime-poster img, .featured-image img, .entry-content img').first().attr('src');
  if (!poster) {
    poster = $('img[class*="poster"], img[class*="featured"], img[class*="cover"]').first().attr('src');
  }

  // ── Extract Description ──
  let description = $('.description, .anime-description, .entry-content p').first().text().trim();
  if (!description || description.length < 20) {
    description = $('.entry-content').first().text().trim().slice(0, 500);
  }

  // ── Extract Genres ──
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a').each((_, element) => {
    const text = $(element).text().trim();
    if (text) genre.push(text);
  });

  // ── Extract Episodes ──
  const episodes: Episode[] = [];

  // Try multiple episode list selectors
  const episodeSelectors = [
    '.episode-list li a',
    '.episodes li a',
    '.episode-list a',
    '.eplist li a',
    '.episode-item a',
    '.anime-episodes a',
    '#episode-list a',
    '.entry-content ul li a[href*="/episode/"]'
  ];

  let found = false;
  for (const selector of episodeSelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((index, element) => {
        const link = $(element).attr('href');
        const epTitle = $(element).text().trim() || `Episode ${index + 1}`;
        if (link) {
          const episodeNum = index + 1;
          const id = link.split('/').filter(Boolean).pop() || `${animeId}-ep${episodeNum}`;
          episodes.push({
            season: 1,
            episode: episodeNum,
            title: epTitle,
            id: id,
          });
        }
      });
      found = true;
      break;
    }
  }

  // Fallback: look for any link containing "/episode/"
  if (!found) {
    $('a[href*="/episode/"]').each((index, element) => {
      const link = $(element).attr('href');
      const epTitle = $(element).text().trim() || `Episode ${index + 1}`;
      if (link) {
        const id = link.split('/').filter(Boolean).pop() || `${animeId}-ep${index + 1}`;
        episodes.push({
          season: 1,
          episode: index + 1,
          title: epTitle,
          id: id,
        });
      }
    });
  }

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

/**
 * Get the video URL for a specific episode.
 * The episode ID is the slug or the full URL part.
 */
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  // Try multiple URL patterns
  const urlPatterns = [
    `${BASE_URL}/episode/${episodeId}/`,
    `${BASE_URL}/watch/${episodeId}/`,
    `${BASE_URL}/ep/${episodeId}/`,
    `${BASE_URL}/${episodeId}/`,
  ];

  let html = '';
  let successUrl = '';

  for (const url of urlPatterns) {
    try {
      html = await fetchHTML(url);
      successUrl = url;
      break;
    } catch (error) {
      // continue to next pattern
    }
  }

  if (!html) {
    console.warn(`Could not fetch episode page for: ${episodeId}`);
    return null;
  }

  const $ = cheerio.load(html);

  // ── Look for iframe ──
  const iframeSelectors = [
    'iframe[src*="player"]',
    'iframe[src*="embed"]',
    'iframe[src*="video"]',
    'iframe[src*="vidsrc"]',
    'iframe[src*="stream"]',
    '.video-player iframe',
    '.embed-container iframe',
    '.player iframe',
    '#player iframe',
    '#video-player iframe',
    'iframe'
  ];

  for (const selector of iframeSelectors) {
    const iframeSrc = $(selector).first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }
  }

  // ── Look for video source ──
  const videoSrc = $('video source').first().attr('src');
  if (videoSrc) {
    if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
    if (videoSrc.startsWith('/')) return `${BASE_URL}${videoSrc}`;
    return videoSrc;
  }

  // ── Look for video element's src ──
  const videoElementSrc = $('video').first().attr('src');
  if (videoElementSrc) {
    if (videoElementSrc.startsWith('//')) return `https:${videoElementSrc}`;
    if (videoElementSrc.startsWith('/')) return `${BASE_URL}${videoElementSrc}`;
    return videoElementSrc;
  }

  // ── Look for data attributes ──
  const dataSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
                  $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
                  $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
  if (dataSrc) {
    if (dataSrc.startsWith('//')) return `https:${dataSrc}`;
    if (dataSrc.startsWith('/')) return `${BASE_URL}${dataSrc}`;
    return dataSrc;
  }

  console.warn(`No stream found for episode: ${episodeId}`);
  return null;
}
