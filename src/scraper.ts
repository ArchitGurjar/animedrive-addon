// src/scraper.ts
// ──────────────────────────────────────────────────────────────────────────────
//  IMPORTS
// ──────────────────────────────────────────────────────────────────────────────

// axios – HTTP client for making requests
import axios from 'axios';
// cheerio – parses HTML and lets us query it with jQuery-like selectors
import * as cheerio from 'cheerio';
// Type definitions for our data structures
import { AnimeItem, MetaDetails, Episode } from './types';

// ──────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────

// The base URL of the site we're scraping
const BASE_URL = 'https://www.desidubanime.me';

// ScraperAPI key – used to bypass Cloudflare. Set in Render environment variables.
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: fetchHTML – Fetch a page with smart retries and optional rendering
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetches HTML from a URL using ScraperAPI (if key is provided) or direct axios.
 * Uses "smart rendering": pages that need JavaScript (like /anime/ and /watch/)
 * get `&render=true`, while static pages (like /az-list/) skip it for speed.
 * Retries up to 3 times with exponential backoff if the response is incomplete.
 *
 * @param url - The URL to fetch
 * @param retries - Number of retry attempts (default 3)
 * @returns The HTML content as a string
 * @throws If all retries fail
 */
async function fetchHTML(url: string, retries = 3): Promise<string> {
  // Store the last error so we can report it if all retries fail
  let lastError: Error | null = null;

  // Loop through retry attempts
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Determine if this page needs JavaScript rendering.
      // Static pages (az-list, search, pagination) do NOT need render.
      const needsRender = !(
        url.includes('/az-list/') ||
        url.includes('/search/') ||
        url.includes('/page/')
      );

      // Build the final URL – use ScraperAPI if we have a key, otherwise direct.
      let finalUrl = url;
      if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
        finalUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
        // Add render and country_code for dynamic pages
        if (needsRender) {
          finalUrl += '&render=true&country_code=US';
        }
      }

      // Log what we're doing (helps with debugging on Render)
      console.log(`[fetch] Attempt ${attempt}/${retries} - ${needsRender ? 'with' : 'without'} render`);

      // Make the request with appropriate timeout (longer for render mode)
      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://www.desidubanime.me/',
        },
        timeout: needsRender ? 60000 : 30000, // 60s for render, 30s otherwise
      });

      // Log the response size – useful to detect if we got a Cloudflare block page
      console.log(`[fetch] Response size: ${response.data.length} bytes, status: ${response.status}`);

      // If the response is very small, it's probably an error page or Cloudflare challenge.
      // The full HTML of a real page is usually > 5000 bytes.
      if (response.data.length < 5000) {
        console.warn(`[fetch] Warning: Response is very small (${response.data.length} bytes). Trying again...`);
        throw new Error(`Incomplete response (${response.data.length} bytes)`);
      }

      // Success – return the HTML
      return response.data;
    } catch (error) {
      // Store the error and log it
      lastError = error;
      console.error(`[fetch] Attempt ${attempt} failed:`, error.message);

      // If we have retries left, wait with exponential backoff before retrying
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`[fetch] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted – throw the last error
  throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${lastError?.message}`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: extractSlug – Get the last part of a URL (the slug)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the slug from a URL.
 * Example: "https://www.desidubanime.me/anime/grand-blue-season-3/" -> "grand-blue-season-3"
 */
function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  // The slug is usually the last part, but if the URL ends with a slash, the last part is empty,
  // so we fall back to the second-to-last.
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

// ──────────────────────────────────────────────────────────────────────────────
//  CATALOG: getAllAnime – Fetches all anime from the A‑Z list
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Gets the full catalog of anime from the A‑Z list page.
 * Each anime is inside an <article class="anime-card">.
 * We extract title, poster, and slug (from the "Info" button's onclick).
 *
 * @returns An array of AnimeItem objects
 */
export async function getAllAnime(): Promise<AnimeItem[]> {
  const url = `${BASE_URL}/az-list/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];
  const seen = new Set<string>(); // Prevent duplicates

  // Look for each anime card
  $('article.anime-card').each((_, article) => {
    // Title: from <h3> <a>
    const titleEl = $(article).find('h3 a').first();
    // Clean the title: take only the first line (English title) and trim whitespace
    const rawTitle = titleEl.text().trim();
    const title = rawTitle.split('\n')[0].trim();
    if (!title || title.length < 2) return;

    // Poster: from the first <img> inside the card
    const poster = $(article).find('img').first().attr('src') || '';

    // Slug: extract from the "Info" button's onclick attribute.
    // The button has: window.location.href='https://.../anime/xxxx/'
    let slug = '';
    const infoBtn = $(article).find('button[onclick*="window.location.href="]').first();
    if (infoBtn.length) {
      const onclick = infoBtn.attr('onclick') || '';
      const match = onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        const urlParts = match[1].split('/');
        // The slug is the second-to-last part (the part before the trailing slash)
        slug = urlParts[urlParts.length - 2] || '';
      }
    }

    // If we couldn't get a slug, skip this entry
    if (!slug) return;
    // Avoid duplicates
    if (seen.has(slug)) return;
    seen.add(slug);

    items.push({
      id: slug,
      name: title,
      poster: poster || undefined,
      type: 'series',
    });
  });

  // Fallback: if no cards were found (e.g., site structure changed), try generic links
  if (items.length === 0) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;
      let title = $(el).text().trim();
      if (!title || title.length < 2) {
        title = $(el).find('img').attr('alt') || '';
      }
      if (!title || title.length < 2) return;
      // Skip "Watch Now" buttons
      if (['watch now', 'play', 'watch', 'now'].includes(title.toLowerCase())) return;
      const slug = extractSlug(link);
      if (seen.has(slug)) return;
      seen.add(slug);
      const poster = $(el).find('img').attr('src') || '';
      items.push({
        id: slug,
        name: title,
        poster: poster || undefined,
        type: 'series',
      });
    });
  }

  console.log(`[Catalog] Found ${items.length} anime from A‑Z list`);
  return items;
}

// ──────────────────────────────────────────────────────────────────────────────
//  CATALOG: getRecentAnime – Kept for backward compatibility
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Legacy function for compatibility; simply returns the full catalog.
 */
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  return getAllAnime();
}

// ──────────────────────────────────────────────────────────────────────────────
//  META: getAnimeDetails – Fetches details + episodes for a single anime
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Gets detailed information for a specific anime, including its episode list.
 * It scrapes the anime detail page (/anime/{slug}/) and extracts:
 * - Title (cleaned)
 * - Poster
 * - Description
 * - Genres
 * - Episodes (with deduplication, filtering out "Watch Now" buttons)
 *
 * @param animeId - The slug of the anime (e.g., 'grand-blue-season-3')
 * @returns A MetaDetails object or null if not found
 */
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── DEBUG: Check if the episode container exists ──
  const episodeContainer = $('.episode-list-display-box');
  console.log(`[Meta] Episode container found: ${episodeContainer.length > 0}`);

  // ── TITLE ──
  // First try the primary selector: inside .anime-data h4 a
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) {
    // Fallback: common page title selectors
    title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  }
  if (!title) {
    // Last resort: take the first <h1> on the page
    title = $('h1').first().text().trim();
  }
  // Clean title: take the first line only (removes any extra Japanese title)
  title = title.split('\n')[0].trim();

  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    return null;
  }

  // ── POSTER ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img').first().attr('src');

  // ── DESCRIPTION ──
  // Target the synopsis paragraph inside .anime-synopsis .prose
  const description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim();
  // If no description found, leave it as empty string (the return will set a default)

  // ── GENRES ──
  const genre: string[] = [];
  // Try multiple selectors that might contain genre links
  $('.genres a, .genre a, .anime-genres a, .category a, .tags a').each((_, el) => {
    const t = $(el).text().trim();
    if (t) genre.push(t);
  });

  // If no genres found with the above, try the more specific flex container
  if (genre.length === 0) {
    $('.flex.gap-2.text-sm.text-text a[href*="/genre/"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genre.push(t);
    });
  }

  // ── EPISODES ──
  const episodes: Episode[] = [];
  const seenIds = new Set<string>();

  // PRIMARY: Extract from .episode-list-display-box a.episode-list-item
  $('.episode-list-display-box a.episode-list-item').each((_, el) => {
    const href = $(el).attr('href');
    const epNum = $(el).find('.episode-list-item-number').text().trim();
    const epTitle = $(el).find('.episode-list-item-title').text().trim();

    // Skip if missing number or href, or if it's a "Watch Now" button
    if (!epNum || !href) return;
    if (epTitle.toLowerCase().includes('watch now')) return;

    const num = parseInt(epNum, 10);
    if (isNaN(num)) return;

    // Build the episode ID from the href slug
    const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;

    // Prevent duplicates (e.g., if the same episode appears twice)
    if (seenIds.has(id)) return;
    seenIds.add(id);

    episodes.push({
      season: 1, // The site doesn't show seasons; we assume season 1
      episode: num,
      title: epTitle || `Episode ${num}`,
      id: id,
    });
  });

  // FALLBACK 1: If no episodes found, look for any link to /watch/
  if (episodes.length === 0) {
    console.log('[Meta] No episodes found with primary selector, trying fallback...');
    $('a[href*="/watch/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = $(el).text().trim();
      // Try to extract episode number from text or URL
      const match = text.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          episodes.push({
            season: 1,
            episode: num,
            title: text || `Episode ${num}`,
            id: id,
          });
        }
      }
    });
  }

  // FALLBACK 2: look for any link containing "/episode/"
  if (episodes.length === 0) {
    $('a[href*="/episode/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = $(el).text().trim();
      const match = text.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          episodes.push({
            season: 1,
            episode: num,
            title: text || `Episode ${num}`,
            id: id,
          });
        }
      }
    });
  }

  // Log how many episodes we found
  console.log(`[Meta] Found ${episodes.length} episodes for ${animeId}`);

  // Return the complete meta object
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

// ──────────────────────────────────────────────────────────────────────────────
//  STREAM: getEpisodeStream – Gets the video URL for an episode
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Gets the video stream URL for a specific episode.
 * It first fetches the watch page, extracts the embed iframe URL,
 * then attempts to find a direct video URL (MP4, M3U8) from that embed page.
 * If no direct video is found, it returns the embed URL as a fallback.
 *
 * @param episodeId - The slug of the episode (e.g., 'grand-blue-season-3-episode-1')
 * @returns A video URL (direct or embed) or null if not found
 */
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  const watchUrl = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching watch page: ${watchUrl}`);

  try {
    // Fetch the watch page
    const watchHtml = await fetchHTML(watchUrl);
    const $ = cheerio.load(watchHtml);

    // Find the iframe that contains the video player
    let embedUrl = $('.episode-player-box iframe').first().attr('src');
    if (!embedUrl) {
      // Fallback: any iframe with src containing "embed", "player", or "video"
      embedUrl = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    }

    // If no iframe found, we can't proceed
    if (!embedUrl) {
      console.warn(`[Stream] No iframe found for ${episodeId}`);
      return null;
    }

    // Make the embed URL absolute
    if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
    if (embedUrl.startsWith('/')) embedUrl = `${BASE_URL}${embedUrl}`;

    console.log(`[Stream] Found embed URL: ${embedUrl}`);

    // Try to extract a direct video URL from the embed page
    const directVideo = await extractDirectVideo(embedUrl);
    if (directVideo) {
      console.log(`[Stream] Extracted direct video: ${directVideo}`);
      return directVideo;
    }

    // No direct video found – return the embed URL (it may still play in Stremio)
    console.log(`[Stream] No direct video found, returning embed URL`);
    return embedUrl;
  } catch (error) {
    console.error(`[Stream] Error:`, error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: extractDirectVideo – Fetches an embed page and looks for a video URL
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Given an embed page URL (e.g., https://gdmirrorbot.nl/embed/xxxx),
 * fetches the page (using ScraperAPI with render to execute JavaScript)
 * and searches for a direct video URL.
 *
 * It looks for:
 * - <video src="..."> or <video><source src="...">
 * - data-src, data-video, data-stream attributes
 * - .m3u8 or .mp4 URLs inside <script> tags
 *
 * @param embedUrl - The URL of the embed page
 * @returns The direct video URL as a string, or null if none found
 */
async function extractDirectVideo(embedUrl: string): Promise<string | null> {
  try {
    let finalUrl = embedUrl;
    if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
      finalUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(embedUrl)}&render=true&country_code=US`;
    }

    const response = await axios.get(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 60000,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // ─── 1. Video element / source ──────────────────────────────
    let videoSrc = $('video').first().attr('src') || $('video source').first().attr('src');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // ─── 2. data-src / data-video / data-stream ────────────────
    videoSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // ─── 3. Search inside <script> tags ────────────────────────
    const scriptContent = $('script').map((_, el) => $(el).html() || '').get().join('\n');

    // 3a. HLS (.m3u8)
    let match = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    if (match) return match[0];

    // 3b. MP4
    match = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/);
    if (match) return match[0];

    // 3c. WebM
    match = scriptContent.match(/https?:\/\/[^\s"']+\.webm[^\s"']*/);
    if (match) return match[0];

    // 3d. Any video URL pattern (generic)
    match = scriptContent.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8|webm)[^\s"']*/i);
    if (match) return match[0];

    // ─── 4. Look for window.location / player config ──────────
    // Some embed pages redirect via JS or store URL in a variable
    let redirectMatch = scriptContent.match(/window\.location\.(?:href|replace)\s*=\s*['"]([^'"]+)['"]/);
    if (redirectMatch && redirectMatch[1]) {
      // Follow the redirect (could be another embed or direct video)
      const redirectUrl = redirectMatch[1];
      if (redirectUrl.startsWith('http')) {
        // Recursive call to handle the redirected URL
        return await extractDirectVideo(redirectUrl);
      }
    }

    // 5. Look for fileId and construct IQSmartGames direct URL (if pattern matches)
    // Many embed pages from desidubanime.me use IQSmartGames
    const fileIdMatch = html.match(/gdmrfid\s*value\s*=\s*['"]([^'"]+)['"]/);
    if (fileIdMatch && fileIdMatch[1]) {
      const fileId = fileIdMatch[1];
      // Try constructing the direct URL from known patterns
      // This is specific to IQSmartGames domain
      const possibleUrls = [
        `https://ddn.iqsmartgames.com/file/${fileId}`,
        `https://cdn.iqsmartgames.com/file/${fileId}`,
        `https://pro.iqsmartgames.com/file/${fileId}`,
      ];
      for (const url of possibleUrls) {
        // Verify if it's a valid video URL (head request)
        try {
          const head = await axios.head(url, { timeout: 5000 });
         if (head.status === 200 && String(head.headers['content-type']).startsWith('video/')) {
            return url;
          }
        } catch (_) {}
      }
    }

    // ─── 6. Look for encoded / obfuscated URLs (common on some hosts) ───
    // Sometimes video URL is base64 encoded in the script
    const b64Match = scriptContent.match(/atob\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (b64Match) {
      try {
        const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
        const videoUrlMatch = decoded.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8|webm)[^\s"']*/i);
        if (videoUrlMatch) return videoUrlMatch[0];
      } catch (_) {}
    }

    console.warn(`[Stream] No direct video found in embed page`);
    return null;
  } catch (error) {
    console.error(`[Stream] Failed to extract direct video from embed:`, error);
    return null;
  }
}
