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

// ─── CATALOG ────────────────────────────────────────────────────────

export async function getRecentAnime(page: number = 1): Promise<AnimeItem[]> {
  const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const items: AnimeItem[] = [];

  // Try multiple selectors for anime cards
  const cardSelectors = [
    '.anime-card',
    '.anime-item',
    '.post-item',
    '.movie-item',
    '.anime-grid .item',
    '.anime-list .anime',
    '.anime-poster',
    '.entry-content .anime'
  ];

  let found = false;
  for (const selector of cardSelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, element) => {
        const titleElement = $(element).find('a, .title, h3, .anime-title').first();
        const title = titleElement.text().trim() || $(element).find('img').attr('alt') || '';
        const link = titleElement.attr('href') || $(element).find('a').attr('href') || '';
        const poster = $(element).find('img').attr('src') || $(element).find('img').attr('data-src') || '';
        if (title && link) {
          const slug = extractSlug(link);
          items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
        }
      });
      found = true;
      break;
    }
  }

  // Fallback: look for any link with /anime/
  if (!found) {
    $('a[href*="/anime/"]').each((_, element) => {
      const link = $(element).attr('href');
      if (!link) return;
      const title = $(element).text().trim() || $(element).find('img').attr('alt') || '';
      const poster = $(element).find('img').attr('src') || '';
      if (title && link && link.includes('/anime/')) {
        const slug = extractSlug(link);
        items.push({ id: slug, name: title, poster: poster || undefined, type: 'series' });
      }
    });
  }

  // Remove duplicates
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

// ─── META ──────────────────────────────────────────────────────────

export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
  // Try both /anime/{slug}/ and /{slug}/ patterns
  let url = `${BASE_URL}/anime/${animeId}/`;
  let html: string;
  try {
    html = await fetchHTML(url);
  } catch {
    url = `${BASE_URL}/${animeId}/`;
    html = await fetchHTML(url);
  }

  const $ = cheerio.load(html);

  // ── Extract Title ──
  let title = $('h1.entry-title').first().text().trim();
  if (!title) title = $('.anime-title, .post-title, .entry-header h1').first().text().trim();
  if (!title) {
    console.warn(`No title found for: ${animeId}`);
    return null;
  }

  // ── Extract Poster ──
  let poster = $('.poster img, .anime-poster img, .featured-image img, .entry-content img').first().attr('src');
  if (!poster) poster = $('img[class*="poster"], img[class*="featured"], img[class*="cover"]').first().attr('src');

  // ── Extract Description ──
  let description = $('.description, .anime-description, .entry-content p').first().text().trim();
  if (!description || description.length < 20) description = $('.entry-content').first().text().trim().slice(0, 500);

  // ── Extract Genres ──
  const genre: string[] = [];
  $('.genres a, .genre a, .anime-genres a, .category a').each((_, el) => {
    const text = $(el).text().trim();
    if (text) genre.push(text);
  });

  // ── Extract Episodes ──

  // 1. Try to use WordPress REST API to get post content (if available)
  let episodes: Episode[] = [];
  try {
    const apiUrl = `${BASE_URL}/wp-json/wp/v2/posts?slug=${animeId}`;
    const apiResponse = await fetchHTML(apiUrl);
    const posts = JSON.parse(apiResponse);
    if (Array.isArray(posts) && posts.length > 0) {
      const content = posts[0].content?.rendered || '';
      if (content) {
        // Parse HTML from the content to find episode links
        const $content = cheerio.load(content);
        const epLinks = $content('a[href*="/episode/"]');
        if (epLinks.length > 0) {
          epLinks.each((index, el) => {
            const link = $(el).attr('href');
            const epTitle = $(el).text().trim() || `Episode ${index + 1}`;
            if (link) {
              const id = link.split('/').filter(Boolean).pop() || `${animeId}-ep${index + 1}`;
              episodes.push({
                season: 1,
                episode: index + 1,
                title: epTitle,
                id: id,
              });
            }
          });
        }
      }
    }
  } catch (e) {
    // API failed, fallback to HTML scraping
  }

  // 2. If REST API didn't work, scrape HTML
  if (episodes.length === 0) {
    const episodeSelectors = [
      '.episode-list li a',
      '.episodes li a',
      '.episode-list a',
      '.eplist li a',
      '.episode-item a',
      '.anime-episodes a',
      '#episode-list a',
      '.entry-content ul li a[href*="/episode/"]',
      '.entry-content a[href*="/episode/"]',
      '.post-content a[href*="/episode/"]',
      '.episode a',
      'ul.episodes a',
    ];

    for (const selector of episodeSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.each((index, el) => {
          const link = $(el).attr('href');
          const epTitle = $(el).text().trim() || `Episode ${index + 1}`;
          if (link) {
            const id = link.split('/').filter(Boolean).pop() || `${animeId}-ep${index + 1}`;
            episodes.push({
              season: 1,
              episode: index + 1,
              title: epTitle,
              id: id,
            });
          }
        });
        break;
      }
    }

    // Last resort: look for any link containing "/episode/"
    if (episodes.length === 0) {
      $('a[href*="/episode/"]').each((index, el) => {
        const link = $(el).attr('href');
        const epTitle = $(el).text().trim() || `Episode ${index + 1}`;
        if (link) {
          const id = link.split('/').filter(Boolean).pop() || `${animeId}-ep${index + 1}`;
          episodes.push({
            season: 1,
            episode: index + 1,
            title: epTitle,
            id: id,
          });
        }
      });
    }
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
  // Try multiple URL patterns
  const urlPatterns = [
    `${BASE_URL}/episode/${episodeId}/`,
    `${BASE_URL}/watch/${episodeId}/`,
    `${BASE_URL}/ep/${episodeId}/`,
    `${BASE_URL}/${episodeId}/`,
  ];

  let html = '';
  let successUrl = '';
  for (const url of urlPatterns) {
    try {
      html = await fetchHTML(url);
      successUrl = url;
      break;
    } catch (e) {
      // continue
    }
  }
  if (!html) {
    console.warn(`Could not fetch episode page for: ${episodeId}`);
    return null;
  }

  const $ = cheerio.load(html);

  // Look for iframe
  const iframeSelectors = [
    'iframe[src*="player"]',
    'iframe[src*="embed"]',
    'iframe[src*="video"]',
    'iframe[src*="vidsrc"]',
    'iframe[src*="stream"]',
    '.video-player iframe',
    '.embed-container iframe',
    '.player iframe',
    '#player iframe',
    '#video-player iframe',
    'iframe'
  ];

  for (const selector of iframeSelectors) {
    const iframeSrc = $(selector).first().attr('src');
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
      if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
      return iframeSrc;
    }
  }

  // Look for video source
  const videoSrc = $('video source').first().attr('src') || $('video').first().attr('src');
  if (videoSrc) {
    if (videoSrc.startsWith('//')) return `https:${videoSrc}`;
    if (videoSrc.startsWith('/')) return `${BASE_URL}${videoSrc}`;
    return videoSrc;
  }

  // Look for data attributes
  const dataSrc = $('[data-src], [data-video], [data-stream]').first().attr('data-src') ||
                  $('[data-src], [data-video], [data-stream]').first().attr('data-video') ||
                  $('[data-src], [data-video], [data-stream]').first().attr('data-stream');
  if (dataSrc) {
    if (dataSrc.startsWith('//')) return `https:${dataSrc}`;
    if (dataSrc.startsWith('/')) return `${BASE_URL}${dataSrc}`;
    return dataSrc;
  }

  console.warn(`No stream found for episode: ${episodeId}`);
  return null;
}
