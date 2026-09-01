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
 * Extract slug from URL.
 * Example: "https://www.desidubanime.me/anime/demon-slayer-season-3/" -> "demon-slayer-season-3"
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
 * Get the list of anime from the homepage.
 * Uses the "Most Popular" or "Top Airing" sections.
 * Supports pagination via ?page=N.
 */
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // The homepage has multiple sections; we look for anime cards.
  // Common selectors from the HTML: .flex.gap-5.border-b (Most Popular list)
  // Also there are grid items in .grid .relative
  // We'll try multiple selectors.

  // Selector for anime cards in "Most Popular" and other sections
  const cardSelectors = [
    '.flex.gap-5.border-b',          // Most Popular list items
    '.grid .relative',               // Grid items
    '.anime-card',                   // Generic
    '.post-item',
    '.movie-item'
  ];

  let found = false;
  for (const selector of cardSelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, element) => {
        const titleElement = $(element).find('a, .title, h3, .anime-title, .font-medium a').first();
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
 * Uses the anime slug to fetch the anime detail page.
 */
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── Extract Title ──
  // Title is in h4 a inside .anime-data, with two language variants.
  // We'll take the English one (first span) or fallback to text.
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) {
    title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  }
  if (!title) {
    console.warn(`Could not find title for anime: ${animeId}`);
    return null;
  }

  // ── Extract Poster ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img, .featured-image img').first().attr('src');

  // ── Extract Description ──
  const description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim();

  // ── Extract Genres ──
  // Genres might be in the page, but they are not present in the episode page.
  // On the anime page, they are often inside .genres or .anime-genres.
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a, .tags a').each((_, element) => {
    const text = $(element).text().trim();
    if (text) genre.push(text);
  });

  // ── Extract Episodes ──
  const episodes: Episode[] = [];

  // On the anime detail page, episodes are inside .episode-list-display-box
  // Each episode is an <a> with class .episode-list-item
  $('.episode-list-display-box a.episode-list-item').each((_, element) => {
    const href = $(element).attr('href');
    const epNumber = $(element).find('.episode-list-item-number').text().trim();
    const epTitle = $(element).find('.episode-list-item-title').text().trim();

    if (href && epNumber) {
      const episodeNum = parseInt(epNumber, 10);
      // Generate a unique ID from the href (slug)
      const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${episodeNum}`;
      episodes.push({
        season: 1, // The site doesn't show seasons separately; we assume season 1.
        episode: episodeNum,
        title: epTitle || `Episode ${episodeNum}`,
        id: id,
      });
    }
  });

  // If no episodes found, try a fallback: look for any link containing "/watch/"
  if (episodes.length === 0) {
    $('a[href*="/watch/"]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      // Try to extract episode number from the URL or text
      const epText = $(element).text().trim();
      const match = epText.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const episodeNum = parseInt(match[1], 10);
        const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${episodeNum}`;
        episodes.push({
          season: 1,
          episode: episodeNum,
          title: epText || `Episode ${episodeNum}`,
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

/**
 * Get the video URL for a specific episode.
 * The episode ID is the slug from the watch page URL.
 */
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  // The episodeId is the last part of the watch page URL.
  // For example, "kimetsu-no-yaiba-katanakaji-no-sato-hen-season-3-episode-1"
  const url = `${BASE_URL}/watch/${episodeId}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // Look for the iframe inside .episode-player-box
  const iframeSrc = $('.episode-player-box iframe').first().attr('src');
  if (iframeSrc) {
    if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
    if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
    return iframeSrc;
  }

  // Fallback: look for any iframe
  const anyIframe = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
  if (anyIframe) {
    if (anyIframe.startsWith('//')) return `https:${anyIframe}`;
    if (anyIframe.startsWith('/')) return `${BASE_URL}${anyIframe}`;
    return anyIframe;
  }

  // Fallback: look for video source
  const videoSrc = $('video source').first().attr('src');
  if (videoSrc) {
    if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
    if (videoSrc.startsWith('/')) return `${BASE_URL}${videoSrc}`;
    return videoSrc;
  }

  console.warn(`No stream found for episode: ${episodeId}`);
  return null;
}
