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

  // Try the most common A‑Z list structure: <ul class="az-list"> <li> <a>
  const selectors = [
    '.az-list a[href*="/anime/"]',
    '.letter-section a[href*="/anime/"]',
    '.anime-grid a[href*="/anime/"]',
    '.post-list a[href*="/anime/"]',
    'ul.az-list a[href*="/anime/"]',
    '.entry-content a[href*="/anime/"]',
    'a[href*="/anime/"]', // fallback
  ];

  let found = false;
  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length) {
      elements.each((_, el) => {
        const link = $(el).attr('href');
        if (!link || !link.includes('/anime/')) return;

        // Get title: prefer text of the anchor, but if it's an image, get alt text
        let title = $(el).text().trim();
        if (!title || title.length < 2) {
          title = $(el).find('img').attr('alt') || '';
        }
        if (!title || title.length < 2) return;

        // Skip generic texts
        if (['watch now', 'play', 'watch', 'now', 'more'].includes(title.toLowerCase())) return;

        const slug = extractSlug(link);
        if (seen.has(slug)) return;
        seen.add(slug);

        // Poster: look for an image inside the anchor or a sibling
        let poster = $(el).find('img').attr('src') || '';
        if (!poster) {
          // Sometimes the poster is in a previous sibling or parent
          const parent = $(el).closest('li, div');
          poster = parent.find('img').first().attr('src') || '';
        }

        items.push({
          id: slug,
          name: title,
          poster: poster || undefined,
          type: 'series',
        });
      });
      found = true;
      break;
    }
  }

  // If still no items, fallback to any link with /anime/ that has a title longer than 2 chars
  if (!found) {
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

  // Episodes
  const episodes: Episode[] = [];

  // Primary selector
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

  // Fallback: any link to /watch/
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
