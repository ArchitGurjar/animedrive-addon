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
//  CATALOG: getAllAnime – with pagination support (if any)
// ──────────────────────────────────────────────────────────────────────────────
export async function getAllAnime(page: number = 1): Promise<AnimeItem[]> {
  // The site uses a single A-Z list, but if pagination exists, we can handle it.
  // Currently, the A-Z list shows all anime on one page.
  const url = page === 1 ? `${BASE_URL}/az-list/` : `${BASE_URL}/az-list/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];
  const seen = new Set<string>();

  // Primary selector: article.anime-card
  $('article.anime-card').each((_, article) => {
    const titleEl = $(article).find('h3 a').first();
    const rawTitle = titleEl.text().trim();
    const title = rawTitle.split('\n')[0].trim();
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

  // Fallback: generic links
  if (items.length === 0) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;
      let title = $(el).text().trim();
      if (!title || title.length < 2) title = $(el).find('img').attr('alt') || '';
      if (!title || title.length < 2) return;
      if (['watch now', 'play', 'watch', 'now'].includes(title.toLowerCase())) return;
      const slug = extractSlug(link);
      if (seen.has(slug)) return;
      seen.add(slug);
      const poster = $(el).find('img').attr('src') || '';
      items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
    });
  }

  // Check for next page (pagination)
  const nextPageLink = $('a.next.page-numbers, a[rel="next"]').attr('href');
  if (nextPageLink) {
    // This indicates there are more pages; we could recursively fetch them,
    // but for simplicity we only fetch the first page. If you want all, uncomment:
    // const nextPageNum = page + 1;
    // const more = await getAllAnime(nextPageNum);
    // items.push(...more);
  }

  console.log(`[Catalog] Found ${items.length} anime from page ${page}`);
  return items;
}

// Legacy
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  return getAllAnime(page);
}

// ──────────────────────────────────────────────────────────────────────────────
//  META: getAnimeDetails – Enhanced with more selectors
// ──────────────────────────────────────────────────────────────────────────────
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── TITLE ──
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) title = $('h1').first().text().trim();
  title = title.split('\n')[0].trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    return null;
  }

  // ── POSTER ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img').first().attr('src');

  // ── DESCRIPTION ──
  const description = $('.anime-synopsis .prose p, .anime-description, .entry-content p').first().text().trim() || 'No description available.';

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
  const episodes: Episode[] = [];
  const seenIds = new Set<string>();

  // Primary: .episode-list-display-box a.episode-list-item
  $('.episode-list-display-box a.episode-list-item').each((_, el) => {
    const href = $(el).attr('href');
    const epNum = $(el).find('.episode-list-item-number').text().trim();
    const epTitle = $(el).find('.episode-list-item-title').text().trim();

    if (!epNum || !href) return;
    if (epTitle.toLowerCase().includes('watch now')) return;

    const num = parseInt(epNum, 10);
    if (isNaN(num)) return;

    const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    episodes.push({
      season: 1,
      episode: num,
      title: epTitle || `Episode ${num}`,
      id: id,
    });
  });

  // Fallback 1: any link to /watch/
  if (episodes.length === 0) {
    $('a[href*="/watch/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = $(el).text().trim();
      const match = text.match(/\d+/) || href.match(/episode-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const id = href.split('/').filter(Boolean).pop() || `${animeId}-ep${num}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          episodes.push({ season: 1, episode: num, title: text || `Episode ${num}`, id });
        }
      }
    });
  }

  // Fallback 2: /episode/ links
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
          episodes.push({ season: 1, episode: num, title: text || `Episode ${num}`, id });
        }
      }
    });
  }

  console.log(`[Meta] Found ${episodes.length} episodes for ${animeId}`);

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

// ──────────────────────────────────────────────────────────────────────────────
//  STREAM: getEpisodeStream – Enhanced with multiple embed extraction
// ──────────────────────────────────────────────────────────────────────────────
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
  const watchUrl = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching watch page: ${watchUrl}`);

  try {
    const watchHtml = await fetchHTML(watchUrl);
    const $ = cheerio.load(watchHtml);

    // Find iframe
    let embedUrl = $('.episode-player-box iframe').first().attr('src');
    if (!embedUrl) {
      embedUrl = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    }
    if (!embedUrl) {
      console.warn(`[Stream] No iframe found for ${episodeId}`);
      return null;
    }

    // Normalize URL
    if (embedUrl.startsWith('//')) embedUrl = `https:${embedUrl}`;
    if (embedUrl.startsWith('/')) embedUrl = `${BASE_URL}${embedUrl}`;

    console.log(`[Stream] Found embed URL: ${embedUrl}`);

    // Try to extract direct video
    const directVideo = await extractDirectVideo(embedUrl);
    if (directVideo) {
      console.log(`[Stream] Extracted direct video: ${directVideo}`);
      return directVideo;
    }

    // Fallback: return embed URL itself
    console.log(`[Stream] No direct video found, returning embed URL`);
    return embedUrl;
  } catch (error) {
    console.error(`[Stream] Error:`, error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  HELPER: extractDirectVideo – Advanced with multiple patterns & fallbacks
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

    // ─── 3. Search in <script> tags ─────────────────────────────
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

    // ─── 7. Generic video URL patterns in HTML (fallback) ──────
    const genericMatch = html.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8|webm)[^\s"']*/i);
    if (genericMatch) return genericMatch[0];

    console.warn(`[Stream] No direct video found in embed page`);
    return null;
  } catch (error) {
    console.error(`[Stream] Failed to extract direct video from embed:`, error);
    return null;
  }
}
