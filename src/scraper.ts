// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

const BASE_URL = 'https://www.desidubanime.me';
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ─── fetchHTML with ScraperAPI ──────────────────────────────────

// ─── fetchHTML with Smart Render & Retry ──────────────────────

async function fetchHTML(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Decide whether to use render=true
      const needsRender = !(
        url.includes('/az-list/') ||
        url.includes('/search/') ||
        url.includes('/page/') // pagination pages are also static
      );

      let finalUrl = url;
      if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
        finalUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
        if (needsRender) {
          finalUrl += '&render=true&country_code=US';
        }
      }

      console.log(`[fetch] Attempt ${attempt}/${retries} - ${needsRender ? 'with' : 'without'} render`);

      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://www.desidubanime.me/',
        },
        timeout: needsRender ? 60000 : 30000, // longer timeout for render mode
      });

      console.log(`[fetch] Response size: ${response.data.length} bytes, status: ${response.status}`);

      // If response is too small, it's probably incomplete
      if (response.data.length < 5000) {
        console.warn(`[fetch] Warning: Response is very small (${response.data.length} bytes). Trying again...`);
        throw new Error(`Incomplete response (${response.data.length} bytes)`);
      }

      return response.data;
    } catch (error) {
      lastError = error;
      console.error(`[fetch] Attempt ${attempt} failed:`, error.message);
      if (attempt < retries) {
        // Exponential backoff: wait 2^attempt seconds before retrying
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[fetch] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${lastError?.message}`);
}

function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

// ─── FULL CATALOG FROM A‑Z LIST ──────────────────────────────────

export async function getAllAnime(): Promise<AnimeItem[]> {
  const url = `${BASE_URL}/az-list/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];
  const seen = new Set<string>();

  $('article.anime-card').each((_, article) => {
    const titleEl = $(article).find('h3 a').first();
    const title = titleEl.text().trim();
    if (!title || title.length < 2) return;

    const poster = $(article).find('img').first().attr('src') || '';

    let slug = '';
    const infoBtn = $(article).find('button[onclick*="window.location.href="]').first();
    if (infoBtn.length) {
      const onclick = infoBtn.attr('onclick') || '';
      const match = onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        const urlParts = match[1].split('/');
        slug = urlParts[urlParts.length - 2] || '';
      }
    }

    if (!slug) return;
    if (seen.has(slug)) return;
    seen.add(slug);

    items.push({
      id: slug,
      name: title,
      poster: poster || undefined,
      type: 'series',
    });
  });

  // Fallback
  if (items.length === 0) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;
      let title = $(el).text().trim();
      if (!title || title.length < 2) {
        title = $(el).find('img').attr('alt') || '';
      }
      if (!title || title.length < 2) return;
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

export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  return getAllAnime();
}

// ─── META (Anime Details + Episodes) ─────────────────────────────

export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // Debug: Check if we got the episode list container
  const episodeContainer = $('.episode-list-display-box');
  console.log(`[Meta] Episode container found: ${episodeContainer.length > 0}`);

  // Title
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    // Try to find title in the HTML as a last resort
    title = $('h1').first().text().trim();
    if (!title) return null;
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

  // ─── Episodes ──────────────────────────────────────────────────
  const episodes: Episode[] = [];

  // Primary: episode list from the anime page
  // The container has class "episode-list-display-box" and each episode is an <a> with class "episode-list-item"
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

  // Fallback 1: any link to /watch/
  if (episodes.length === 0) {
    console.log('[Meta] No episodes found with primary selector, trying fallback...');
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

  // Fallback 2: look for any link containing "/episode/"
  if (episodes.length === 0) {
    $('a[href*="/episode/"]').each((_, el) => {
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
  const watchUrl = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching watch page: ${watchUrl}`);

  try {
    const watchHtml = await fetchHTML(watchUrl);
    const $ = cheerio.load(watchHtml);

    // Primary: iframe inside .episode-player-box
    let embedUrl = $('.episode-player-box iframe').first().attr('src');
    if (!embedUrl) {
      embedUrl = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    }

    if (!embedUrl) {
      console.warn(`[Stream] No iframe found for ${episodeId}`);
      return null;
    }

    if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
    if (embedUrl.startsWith('/')) embedUrl = `${BASE_URL}${embedUrl}`;

    console.log(`[Stream] Found embed URL: ${embedUrl}`);

    // Try to extract direct video from the embed page
    const directVideo = await extractDirectVideo(embedUrl);
    if (directVideo) {
      console.log(`[Stream] Extracted direct video: ${directVideo}`);
      return directVideo;
    }

    console.log(`[Stream] No direct video found, returning embed URL`);
    return embedUrl;

  } catch (error) {
    console.error(`[Stream] Error:`, error);
    return null;
  }
}

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

    // Look for video element with src
    let videoSrc = $('video').first().attr('src') || $('video source').first().attr('src');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // Look for data-src or data-video attributes
    videoSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // Look for m3u8 in script tags
    const scriptContent = $('script').map((_, el) => $(el).html() || '').get().join('\n');
    const hlsMatch = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    if (hlsMatch) return hlsMatch[0];

    const mp4Match = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/);
    if (mp4Match) return mp4Match[0];

    console.warn(`[Stream] No direct video found in embed page`);
    return null;

  } catch (error) {
    console.error(`[Stream] Failed to extract direct video from embed:`, error);
    return null;
  }
}
