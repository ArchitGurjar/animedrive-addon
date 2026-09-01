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
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// ────────────────────────────────────────────────────────────────────────────────
//  HELPER: FETCH HTML
// ────────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────────
//  HELPER: EXTRACT SLUG FROM URL
// ────────────────────────────────────────────────────────────────────────────────
function extractSlug(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || parts[parts.length - 2] || url;
}

// ────────────────────────────────────────────────────────────────────────────────
//  CATALOG: getRecentAnime(page)
//  Scrapes the homepage's "Top Airing" and "Most Popular" sections.
//  Uses precise selectors to extract anime titles instead of "Watch Now" buttons.
// ────────────────────────────────────────────────────────────────────────────────
export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  // The homepage doesn't support pagination, but we keep the parameter for consistency.
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // ── APPROACH: Find sections by heading text ──
  // The homepage has headings like "Top Airing!" and "Most Popular".
  // We'll locate these headings and then extract all anime links that follow.
  const sections = ['Top Airing', 'Most Popular'];
  const processed = new Set<string>();

  sections.forEach(sectionName => {
    // Find an element that contains the exact heading text (case-insensitive)
    const heading = $(`*:contains("${sectionName}")`).filter(function(this: any) {
      return $(this).text().trim() === sectionName || $(this).text().trim() === sectionName + '!';
    }).first();

    if (heading.length === 0) return;

    // Traverse siblings until we reach the next heading (h2, h3, etc.)
    let current = heading.next();
    let found = 0;
    const maxItems = 30;

    while (current.length && found < maxItems) {
      // Look for links inside this sibling that point to /anime/
      const links = current.find('a[href*="/anime/"]');
      links.each((_, el) => {
        const link = $(el).attr('href');
        if (!link) return;

        // Skip if it's a "Watch Now" button (commonly has classes like .watch-now, .play, .btn)
        const isWatchNow = $(el).hasClass('watch-now') ||
                           $(el).hasClass('play') ||
                           $(el).hasClass('btn') ||
                           $(el).closest('.watch-now, .play, .btn').length > 0 ||
                           $(el).text().trim().toLowerCase() === 'watch now' ||
                           $(el).text().trim().toLowerCase() === 'play';

        if (isWatchNow) return;

        // Get the title – prefer the text content, fallback to alt text of an image
        let title = $(el).text().trim();
        if (!title || title.length < 2) {
          title = $(el).find('img').attr('alt') || '';
        }

        // Skip if title is generic or too short
        if (!title || title.length < 2) return;
        if (['watch now', 'play', 'watch', 'now'].includes(title.toLowerCase())) return;

        const slug = extractSlug(link);
        if (processed.has(slug)) return;
        processed.add(slug);

        const poster = $(el).find('img').attr('src') || '';

        items.push({
          id: slug,
          name: title,
          poster: poster || undefined,
          type: 'series',
        });
        found++;
      });

      current = current.next();
    }
  });

  // ── Fallback: If no items found, use a broader selector ──
  if (items.length === 0) {
    $('a[href*="/anime/"]').each((_, el) => {
      const link = $(el).attr('href');
      if (!link) return;

      // Skip if inside a "Watch Now" button
      if ($(el).closest('.watch-now, .play, .btn').length > 0) return;

      let title = $(el).text().trim();
      if (!title || title.length < 2) {
        title = $(el).find('img').attr('alt') || '';
      }
      if (!title || title.length < 2) return;
      if (['watch now', 'play', 'watch', 'now'].includes(title.toLowerCase())) return;

      const slug = extractSlug(link);
      if (processed.has(slug)) return;
      processed.add(slug);

      const poster = $(el).find('img').attr('src') || '';
      items.push({
        id: slug,
        name: title,
        poster: poster || undefined,
        type: 'series',
      });
    });
  }

  // Remove duplicates and return
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

// ────────────────────────────────────────────────────────────────────────────────
//  META: getAnimeDetails(animeId)
//  (Unchanged – working correctly)
// ────────────────────────────────────────────────────────────────────────────────
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

  // Fallback: any link containing "/watch/"
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

// ────────────────────────────────────────────────────────────────────────────────
//  STREAM: getEpisodeStream(episodeId)
//  (Unchanged – working correctly)
// ────────────────────────────────────────────────────────────────────────────────
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
