// src/scraper.ts
// ────────────────────────────────────────────────────────────────────────────────
//  IMPORTS
// ────────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// ────────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ────────────────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://www.desidubanime.me';

// Optional: ScraperAPI key to bypass Cloudflare.
// Set the environment variable SCRAPER_API_KEY on Render.
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ────────────────────────────────────────────────────────────────────────────────
//  HELPER: FETCH HTML
//  Fetches a page with a real browser User‑Agent.
//  If a ScraperAPI key is provided, routes through the proxy to avoid Cloudflare.
// ────────────────────────────────────────────────────────────────────────────────
async function fetchHTML(url: string): Promise<string> {
  try {
    let finalUrl = url;
    if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
      // ScraperAPI format: http://api.scraperapi.com?api_key=KEY&url=ENCODED_URL
      finalUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
    }

    const response = await axios.get(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': BASE_URL,
      },
      timeout: 20000, // 20 seconds
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    throw new Error(`Failed to fetch: ${url}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
//  HELPER: EXTRACT SLUG FROM URL
//  Takes a full URL and returns the last part (slug).
//  Example: "https://.../demon-slayer-season-3/" → "demon-slayer-season-3"
// ────────────────────────────────────────────────────────────────────────────────
function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

// ────────────────────────────────────────────────────────────────────────────────
//  HELPER: FOLLOW REDIRECTS
//  Some embed URLs may redirect; this gives the final URL.
// ────────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────────
//  CATALOG: getRecentAnime(page)
//  Scrapes the homepage for anime cards from "Most Popular", "Top Airing", etc.
//  Supports pagination via ?page=N (Render will pass the query param).
//  Uses multiple selectors to be robust against site changes.
// ────────────────────────────────────────────────────────────────────────────────
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // List of possible selectors for anime cards on the homepage.
  // The site uses different class names for different sections.
  const selectors = [
    '.flex.gap-5.border-b',          // Most Popular list items
    '.grid .relative',               // Grid cards
    '.anime-card',                   // Generic card
    '.post-item',
    '.movie-item'
  ];

  let found = false;
  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length) {
      elements.each((_, el) => {
        // Try to find the title link; it could be inside an <a>, or use alt text from an image.
        const titleEl = $(el).find('a, .title, h3, .anime-title, .font-medium a').first();
        const title = titleEl.text().trim() || $(el).find('img').attr('alt') || '';
        const link = titleEl.attr('href') || $(el).find('a').attr('href') || '';
        const poster = $(el).find('img').attr('src') || '';

        if (title && link) {
          const slug = extractSlug(link);
          items.push({
            id: slug,
            name: title,
            poster: poster || undefined,
            type: 'series',   // can be refined later
          });
        }
      });
      found = true;
      break;
    }
  }

  // Fallback: look for any link containing "/anime/" (very generic)
  if (!found) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;
      const title = $(el).text().trim() || $(el).find('img').attr('alt') || '';
      const poster = $(el).find('img').attr('src') || '';
      if (title && link.includes('/anime/')) {
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

  // Remove duplicates (some items may appear in multiple sections)
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

// ────────────────────────────────────────────────────────────────────────────────
//  META: getAnimeDetails(animeId)
//  Fetches the anime detail page (e.g., /anime/demon-slayer-season-3/)
//  Extracts title, poster, description, genres, and most importantly – the episode list.
//  The episode list is extracted from .episode-list-display-box a.episode-list-item
//  Multiple fallback selectors ensure it works even if the structure changes.
// ────────────────────────────────────────────────────────────────────────────────
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── Title ──
  // The anime page often has two language variants; we take the first <span> inside the <a>.
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    return null;
  }

  // ── Poster ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img').first().attr('src');

  // ── Description ──
  const description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim();

  // ── Genres ──
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a, .tags a').each((_, el) => {
    const t = $(el).text().trim();
    if (t) genre.push(t);
  });

  // ── Episodes ──
  const episodes: Episode[] = [];

  // Primary selector: each episode is an <a> inside .episode-list-display-box with class .episode-list-item
  $('.episode-list-display-box a.episode-list-item').each((_, el) => {
    const href = $(el).attr('href');
    const epNum = $(el).find('.episode-list-item-number').text().trim();
    const epTitle = $(el).find('.episode-list-item-title').text().trim();
    if (href && epNum) {
      const num = parseInt(epNum, 10);
      // The ID for the stream endpoint will be the last part of the href (the slug)
      const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
      episodes.push({
        season: 1,        // The site doesn't show seasons; we assume season 1
        episode: num,
        title: epTitle || `Episode ${num}`,
        id: id,
      });
    }
  });

  // Fallback 1: any link containing "/watch/"
  if (episodes.length === 0) {
    $('a[href*="/watch/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = $(el).text().trim();
      // Try to extract episode number from text or URL
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

  // Fallback 2: look for any <li> or <div> with episode-like classes (if the site changes)
  if (episodes.length === 0) {
    $('.episode-list li a, .episodes li a, .eplist li a, .episode-item a').each((_, el) => {
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

// ────────────────────────────────────────────────────────────────────────────────
//  STREAM: getEpisodeStream(episodeId)
//  episodeId is the slug from the watch URL (e.g., "kimetsu-no-yaiba-...-episode-1")
//  Fetches the watch page and extracts the iframe URL.
//  The iframe is typically inside .episode-player-box iframe.
//  If not found, tries other common iframe selectors and video elements.
// ────────────────────────────────────────────────────────────────────────────────
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  const url = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching: ${url}`);
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    // Primary: the iframe inside .episode-player-box
    let iframeSrc = $('.episode-player-box iframe').first().attr('src');
    if (iframeSrc) {
      // Ensure absolute URL
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

    // Fallback 1: any iframe with src containing "embed", "player", or "video"
    iframeSrc = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

    // Fallback 2: a <video> element's src attribute or a <source> inside it
    const videoSrc = $('video source').first().attr('src') || $('video').first().attr('src');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `${BASE_URL}${videoSrc}`;
      return videoSrc;
    }

    // Fallback 3: data-* attributes that might contain the video URL
    const dataSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
                    $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
                    $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
    if (dataSrc) {
      if (dataSrc.startsWith('//')) return `https:${dataSrc}`;
      if (dataSrc.startsWith('/')) return `${BASE_URL}${dataSrc}`;
      return dataSrc;
    }

    console.warn(`[Stream] No video found for ${episodeId}`);
    return null;
  } catch (error) {
    console.error(`[Stream] Error fetching ${url}:`, error);
    return null;
  }
}
