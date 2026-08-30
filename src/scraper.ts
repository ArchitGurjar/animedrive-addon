// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// ─── CONFIGURATION ───────────────────────────────────────────────────

// Main site for catalog (list of anime)
const MAIN_SITE = 'https://animedrive.me';
// Download site (episode pages)
const DOWNLOAD_SITE = 'https://link.animedrive.me';

// Optional ScraperAPI key (to bypass Cloudflare)
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
        'Referer': MAIN_SITE,
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
 * Resolve an anime slug to its full URL on the download site
 * using the WordPress REST API.
 */
async function resolveAnimeUrl(slug: string): Promise<string | null> {
  try {
    const apiUrl = `${DOWNLOAD_SITE}/wp-json/wp/v2/posts?slug=${slug}`;
    const html = await fetchHTML(apiUrl);
    const data = JSON.parse(html);
    if (Array.isArray(data) && data.length > 0) {
      return data[0].link; // full URL to the post
    }
    return null;
  } catch (error) {
    console.error(`Error resolving slug ${slug}:`, error);
    return null;
  }
}

/**
 * Follow redirects to get the final URL (e.g., after a /dl/ link).
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
 * Get the list of anime from the main site's homepage.
 * Supports pagination via ?page=N.
 */
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${MAIN_SITE}/` : `${MAIN_SITE}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // Each anime post is an <article class="post">
  $('article.post').each((_, element) => {
    const titleElement = $(element).find('h2.entry-title a');
    const title = titleElement.text().trim();
    const link = titleElement.attr('href');
    const poster = $(element).find('div.post-thumb-img-content img').attr('src');

    if (title && link) {
      // Extract slug from the link (last part after domain)
      const slug = link.split('/').filter(Boolean).pop() || link;
      items.push({
        id: slug,                 // use slug as ID
        name: title,
        poster: poster || undefined,
        type: 'series',
      });
    }
  });

  return items;
}

// ─── META ──────────────────────────────────────────────────────────

/**
 * Get detailed info + episodes for a specific anime.
 * Uses the slug to resolve the full URL, then scrapes the page.
 */
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  // 1. Resolve the slug to a full URL
  const url = await resolveAnimeUrl(animeId);
  if (!url) {
    console.warn(`Could not resolve slug: ${animeId}`);
    return null;
  }

  // 2. Fetch the page
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // 3. Extract basic info
  const title = $('h1.entry-title').first().text().trim();
  if (!title) {
    console.warn(`No title found for: ${animeId}`);
    return null;
  }

  const poster = $('.post-thumb-img-content img, .featured-image img').first().attr('src');
  const description = $('.entry-content p').first().text().trim();

  // 4. Extract genres (if any)
  const genre: string[] = [];
  $('.category a, .genres a').each((_, element) => {
    const text = $(element).text().trim();
    if (text) genre.push(text);
  });

  // 5. Extract episodes from the .adc-ep containers
  const episodes: Episode[] = [];

  $('.adc-ep').each((_, element) => {
    const header = $(element).find('.adc-hdr');
    const badge = header.find('.adc-badge').text().trim();
    const epName = header.find('.adc-epname').text().trim();

    // Try to extract episode number from badge (e.g., "EP 01")
    let episodeNum = 1;
    const numMatch = badge.match(/\d+/);
    if (numMatch) {
      episodeNum = parseInt(numMatch[0], 10);
    } else {
      // fallback: use index
      episodeNum = episodes.length + 1;
    }

    // Create a unique ID for the episode: {animeId}-ep{episodeNum}
    const episodeId = `${animeId}-ep${episodeNum}`;

    episodes.push({
      season: 1,                    // we assume season 1 for now
      episode: episodeNum,
      title: epName || `Episode ${episodeNum}`,
      id: episodeId,                // this will be used by the stream endpoint
    });
  });

  // If no episodes found, try a fallback: look for any .adc-ep (should work)
  if (episodes.length === 0) {
    console.warn(`No episodes found for ${animeId}`);
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

// ─── STREAM ────────────────────────────────────────────────────────

/**
 * Get the download URL for a specific episode.
 * The episode ID is expected in the format: {animeSlug}-ep{episodeNum}
 */
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  // 1. Parse the episode ID
  const match = episodeId.match(/^(.*)-ep(\d+)$/);
  if (!match) {
    console.warn(`Invalid episode ID format: ${episodeId}`);
    return null;
  }
  const animeSlug = match[1];
  const episodeNum = parseInt(match[2], 10);

  // 2. Resolve the anime URL
  const animeUrl = await resolveAnimeUrl(animeSlug);
  if (!animeUrl) {
    console.warn(`Could not resolve anime slug: ${animeSlug}`);
    return null;
  }

  // 3. Fetch the anime page
  const html = await fetchHTML(animeUrl);
  const $ = cheerio.load(html);

  // 4. Find the episode container for the given episode number
  let targetElement: cheerio.Cheerio | null = null;
  $('.adc-ep').each((_, element) => {
    const header = $(element).find('.adc-hdr');
    const badge = header.find('.adc-badge').text().trim();
    const numMatch = badge.match(/\d+/);
    if (numMatch && parseInt(numMatch[0], 10) === episodeNum) {
      targetElement = $(element);
      return false; // break the loop
    }
  });

  if (!targetElement) {
    console.warn(`Episode ${episodeNum} not found for ${animeSlug}`);
    return null;
  }

  // 5. Extract download links from the episode body
  const downloadLinks: string[] = [];
  targetElement.find('.adc-btns a.adc-btn').each((_, element) => {
    const href = $(element).attr('href');
    if (href && href.startsWith('https://link.animedrive.me/dl/')) {
      downloadLinks.push(href);
    }
  });

  if (downloadLinks.length === 0) {
    console.warn(`No download links found for episode ${episodeNum}`);
    return null;
  }

  // 6. Optional: prefer a specific quality/hoster
  // For now, return the first link (which is often 1080p or highest quality)
  // We could also follow redirects to get the final video URL.
  const selectedLink = downloadLinks[0];

  // 7. Follow redirects to get the final URL (if needed)
  // This ensures we get the actual video file URL.
  const finalUrl = await followRedirect(selectedLink);
  return finalUrl;
}
