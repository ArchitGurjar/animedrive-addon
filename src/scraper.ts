// src/scraper.ts
// ──────────────────────────────────────────────────────────────────────────────
//  IMPORTS
// ──────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// ──────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const BASE_URL = 'https://www.desidubanime.me';
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const PAGE_SIZE = 20; // For catalog pagination

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: fetchHTML – Smart fetch with retry & render decision
// ──────────────────────────────────────────────────────────────────────────────
async function fetchHTML(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const needsRender = !(
        url.includes('/az-list/') ||
        url.includes('/search/') ||
        url.includes('/page/')
      );

      let finalUrl = url;
      if (SCRAPER_API_KEY && SCRAPER_API_KEY !== '') {
        finalUrl = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
        if (needsRender) finalUrl += '&render=true&country_code=US';
      }

      console.log(`[fetch] Attempt ${attempt}/${retries} - ${needsRender ? 'with' : 'without'} render`);

      const response = await axios.get(finalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://www.desidubanime.me/',
        },
        timeout: needsRender ? 60000 : 30000,
      });

      console.log(`[fetch] Response size: ${response.data.length} bytes, status: ${response.status}`);
      if (response.data.length < 5000) {
        throw new Error(`Incomplete response (${response.data.length} bytes)`);
      }
      return response.data;
    } catch (error) {
      lastError = error;
      console.error(`[fetch] Attempt ${attempt} failed:`, error.message);
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${lastError?.message}`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: extractSlug
// ──────────────────────────────────────────────────────────────────────────────
function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: decodeBase64 – for embed URLs
// ──────────────────────────────────────────────────────────────────────────────
function decodeBase64(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return encoded;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  CATALOG: getAllAnime – with pagination
// ──────────────────────────────────────────────────────────────────────────────
export async function getAllAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${BASE_URL}/az-list/` : `${BASE_URL}/az-list/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];
  const seen = new Set<string>();

  // Each anime card: article.anime-card
  $('article.anime-card').each((_, article) => {
    // Title: from h3 a
    const titleEl = $(article).find('h3 a').first();
    const rawTitle = titleEl.text().trim();
    const title = rawTitle.split('\n')[0].trim();
    if (!title || title.length < 2) return;

    // Poster: first img inside card
    const poster = $(article).find('img').first().attr('src') || '';

    // Slug: from the "Info" button's onclick
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

    // Fallback: look for a direct link to /anime/
    if (!slug) {
      const animeLink = $(article).find('a[href*="/anime/"]').first().attr('href');
      if (animeLink) slug = extractSlug(animeLink);
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

  // Fallback: generic links if no cards found
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
      items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
    });
  }

  console.log(`[Catalog] Found ${items.length} anime on page ${page}`);
  return items;
}

// ──────────────────────────────────────────────────────────────────────────────
//  CATALOG: getRecentAnime – alias for backward compatibility
// ──────────────────────────────────────────────────────────────────────────────
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  return getAllAnime(page);
}

// ──────────────────────────────────────────────────────────────────────────────
//  META: getAnimeDetails – with REST API episodes
// ──────────────────────────────────────────────────────────────────────────────
export async function getAnimeDetails(animeSlug: string): Promise<MetaDetails | null> {
  const detailUrl = `${BASE_URL}/anime/${animeSlug}/`;
  console.log(`[Meta] Fetching: ${detailUrl}`);
  const html = await fetchHTML(detailUrl);
  const $ = cheerio.load(html);

  // ── Extract Anime Post ID ──
  let animeId: number | null = null;
  const idScript = html.match(/var\s+current_post_data_id\s*=\s*(\d+);/);
  if (idScript) animeId = parseInt(idScript[1], 10);
  if (!animeId) {
    console.warn(`[Meta] Could not find anime ID for ${animeSlug}`);
    // Fallback: try to get from a meta tag? We'll skip.
  }

  // ── TITLE ──
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) title = $('h1').first().text().trim();
  title = title.split('\n')[0].trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeSlug}`);
    return null;
  }

  // ── POSTER ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img').first().attr('src');

  // ── DESCRIPTION ──
  let description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim();
  if (!description) {
    // Fallback: from the overview section
    description = $('section[aria-label="Anime Overview"] p').first().text().trim();
  }
  description = description || 'No description available.';

  // ── GENRES ──
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a, .tags a').each((_, el) => {
    const t = $(el).text().trim();
    if (t) genre.push(t);
  });
  if (genre.length === 0) {
    $('.flex.gap-2.text-sm.text-text a[href*="/genre/"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genre.push(t);
    });
  }

  // ── EPISODES ──
  let episodes: Episode[] = [];

  // Try REST API if we have animeId
  if (animeId) {
    try {
      const restUrl = `${BASE_URL}/wp-json/wp/v2/episode?parent=${animeId}&per_page=100&_fields=id,slug,title,content`;
      console.log(`[Meta] Fetching episodes from REST API: ${restUrl}`);
      const response = await axios.get(restUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const data = response.data;
      if (Array.isArray(data) && data.length > 0) {
        episodes = data.map((ep: any) => {
          const slug = ep.slug || '';
          // Extract episode number from slug: look for "episode-(\d+)" or number at end
          let epNum = 0;
          const numMatch = slug.match(/episode-(\d+)/) || slug.match(/-(\d+)$/);
          if (numMatch) epNum = parseInt(numMatch[1], 10);
          const titleText = ep.title?.rendered || ep.title || `Episode ${epNum}`;
          return {
            season: 1, // The site doesn't show seasons; we assume season 1
            episode: epNum,
            title: titleText,
            id: slug,
          };
        });
        // Sort by episode number
        episodes.sort((a, b) => a.episode - b.episode);
        console.log(`[Meta] Found ${episodes.length} episodes via REST API`);
      }
    } catch (error) {
      console.warn(`[Meta] REST API failed, falling back to HTML scraping:`, error.message);
    }
  }

  // Fallback: try to scrape episodes from the detail page (if any static list)
  if (episodes.length === 0) {
    // Look for any links to /watch/ in the page
    $('a[href*="/watch/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      // Avoid duplicate and only take if it's an episode link (contains episode in slug)
      if (!href.includes('-episode-')) return;
      const text = $(el).text().trim();
      const match = text.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const slug = extractSlug(href);
        if (!episodes.some(e => e.id === slug)) {
          episodes.push({
            season: 1,
            episode: num,
            title: text || `Episode ${num}`,
            id: slug,
          });
        }
      }
    });
    episodes.sort((a, b) => a.episode - b.episode);
    console.log(`[Meta] Found ${episodes.length} episodes via HTML fallback`);
  }

  return {
    id: animeSlug,
    name: title,
    poster: poster || undefined,
    type: 'series',
    description,
    genre,
    episodes,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  STREAM: getEpisodeStream – Gets video URL for an episode
// ──────────────────────────────────────────────────────────────────────────────
export async function getEpisodeStream(episodeSlug: string): Promise<string | null> {
  const watchUrl = `${BASE_URL}/watch/${episodeSlug}/`;
  console.log(`[Stream] Fetching watch page: ${watchUrl}`);

  try {
    const html = await fetchHTML(watchUrl);
    const $ = cheerio.load(html);

    // Find the active embed source
    let embedUrl: string | null = null;

    // Look for the active server in .player-selection.player-dub
    const activeServer = $('.player-selection.player-dub span.active[data-embed-id]').first();
    if (activeServer.length) {
      const embedId = activeServer.attr('data-embed-id') || '';
      // Format: "Name:base64url"
      const parts = embedId.split(':');
      if (parts.length === 2) {
        const encoded = parts[1];
        embedUrl = decodeBase64(encoded);
      }
    }

    // If no active server, fallback to the iframe src
    if (!embedUrl) {
      embedUrl = $('.episode-player-box iframe').first().attr('src');
      if (embedUrl) {
        if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
        if (embedUrl.startsWith('/')) embedUrl = `${BASE_URL}${embedUrl}`;
      }
    }

    if (!embedUrl) {
      console.warn(`[Stream] No embed URL found for ${episodeSlug}`);
      return null;
    }

    console.log(`[Stream] Found embed URL: ${embedUrl}`);

    // Try to extract direct video from the embed page
    const directVideo = await extractDirectVideo(embedUrl);
    if (directVideo) {
      console.log(`[Stream] Extracted direct video: ${directVideo}`);
      return directVideo;
    }

    // If no direct video, return the embed URL
    console.log(`[Stream] Returning embed URL as fallback`);
    return embedUrl;
  } catch (error) {
    console.error(`[Stream] Error:`, error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: extractDirectVideo – Parses embed page for direct video URL
// ──────────────────────────────────────────────────────────────────────────────
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

    // ─── 1. <video> tag ──────────────────────────────────────────
    let videoSrc = $('video').first().attr('src') || $('video source').first().attr('src');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // ─── 2. data-* attributes ────────────────────────────────────
    videoSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
               $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
    if (videoSrc) {
      if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
      if (videoSrc.startsWith('/')) return `https://${new URL(embedUrl).hostname}${videoSrc}`;
      return videoSrc;
    }

    // ─── 3. Script content ──────────────────────────────────────
    const scriptContent = $('script').map((_, el) => $(el).html() || '').get().join('\n');

    let match = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    if (match) return match[0];

    match = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/);
    if (match) return match[0];

    match = scriptContent.match(/https?:\/\/[^\s"']+\.webm[^\s"']*/);
    if (match) return match[0];

    match = scriptContent.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8|webm)[^\s"']*/i);
    if (match) return match[0];

    // ─── 4. window.location redirect ────────────────────────────
    let redirectMatch = scriptContent.match(/window\.location\.(?:href|replace)\s*=\s*['"]([^'"]+)['"]/);
    if (redirectMatch && redirectMatch[1]) {
      const redirectUrl = redirectMatch[1];
      if (redirectUrl.startsWith('http')) {
        return await extractDirectVideo(redirectUrl);
      }
    }

    // ─── 5. IQSmartGames (gdmrfid) ──────────────────────────────
    const fileIdMatch = html.match(/gdmrfid\s*value\s*=\s*['"]([^'"]+)['"]/);
    if (fileIdMatch && fileIdMatch[1]) {
      const fileId = fileIdMatch[1];
      const possibleUrls = [
        `https://ddn.iqsmartgames.com/file/${fileId}`,
        `https://cdn.iqsmartgames.com/file/${fileId}`,
        `https://pro.iqsmartgames.com/file/${fileId}`,
      ];
      for (const url of possibleUrls) {
        try {
          const headResponse = await axios.head(url, { timeout: 5000 });
          const contentType = headResponse.headers['content-type'];
          if (headResponse.status === 200 && typeof contentType === 'string' && contentType.startsWith('video/')) {
            return url;
          }
        } catch (_) {}
      }
    }

    // ─── 6. Base64 encoded URL ──────────────────────────────────
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
    console.error(`[Stream] Failed to extract direct video:`, error);
    return null;
  }
}
