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

// ─── FULL CATALOG FROM A‑Z LIST ──────────────────────────────────

export async function getAllAnime(): Promise<AnimeItem[]> {
  const url = `${BASE_URL}/az-list/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];
  const seen = new Set<string>();

  // Each anime is inside an article with class "anime-card"
  $('article.anime-card').each((_, article) => {
    // Title: from h3 > a
    const titleEl = $(article).find('h3 a').first();
    const title = titleEl.text().trim();
    if (!title || title.length < 2) return;

    // Poster: from img inside the card
    const poster = $(article).find('img').first().attr('src') || '';

    // Slug: extract from the "Info" button's onclick attribute
    let slug = '';
    const infoBtn = $(article).find('button[onclick*="window.location.href="]').first();
    if (infoBtn.length) {
      const onclick = infoBtn.attr('onclick') || '';
      // Extract URL inside the quotes: window.location.href='https://.../anime/xxxx/'
      const match = onclick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        const urlParts = match[1].split('/');
        slug = urlParts[urlParts.length - 2] || ''; // get last non‑empty part before trailing slash
      }
    }

    // Fallback: try to extract slug from the watch link (title's href)
    if (!slug) {
      const watchLink = titleEl.attr('href') || '';
      // Remove episode suffix: e.g., "grand-blue-season-3-episode-1" → "grand-blue-season-3"
      // We'll strip "-episode-1" or similar, but it's not perfect.
      // Better to skip if no slug found.
      // For now, we skip.
      return;
    }

    if (seen.has(slug)) return;
    seen.add(slug);

    items.push({
      id: slug,
      name: title,
      poster: poster || undefined,
      type: 'series',
    });
  });

  // If we didn't find any using the article method, fallback to generic links
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

// ─── KEEP getRecentAnime() for backward compatibility ──────────

export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  // You can choose to return the full list or a subset (e.g., first 20)
  return getAllAnime();
}

// ─── META (Anime Details + Episodes) ─────────────────────────────

export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  const url = `${BASE_URL}/anime/${animeId}/`;
  console.log(`[Meta] Fetching: ${url}`);
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  // ── Title ──
  let title = $('.anime-data h4 a span:first-child, .anime-data h4 a').first().text().trim();
  if (!title) title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
  if (!title) {
    console.warn(`[Meta] No title for ${animeId}`);
    return null;
  }

  // ── Poster ──
  const poster = $('.anime-featured img, .poster img, .anime-poster img, .featured-image img').first().attr('src');

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

  // Primary: episode list from the anime page
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
  const url = `${BASE_URL}/watch/${episodeId}/`;
  console.log(`[Stream] Fetching: ${url}`);
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    let iframeSrc = $('.episode-player-box iframe').first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

    iframeSrc = $('iframe[src*="embed"], iframe[src*="player"], iframe[src*="video"]').first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }

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
