// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// Use the main domain – adjust if the site uses a different URL
const BASE_URL = 'https://animedrive.me';

// Helper: fetch HTML with robust headers to mimic a real browser
async function fetchHTML(url: string): Promise<string> {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': BASE_URL,
            },
            timeout: 15000,
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        throw new Error(`Failed to fetch: ${url}`);
    }
}

// ─── CATALOG: Get the list of anime from the homepage ───
export async function getRecentAnime(): Promise<AnimeItem[]> {
    const html = await fetchHTML(`${BASE_URL}/`);
    const $ = cheerio.load(html);
    const items: AnimeItem[] = [];

    // Each anime is an <article> with class 'post'
    $('article.post').each((_, element) => {
        const titleElement = $(element).find('h2.entry-title a');
        const title = titleElement.text().trim();
        const link = titleElement.attr('href');
        const poster = $(element).find('div.post-thumb-img-content img').attr('src');

        // Optional: extract language badges if you want to use them later
        // const languages = $(element).find('div.animedrive-lang-badges span.lang-badge')
        //     .map((_, el) => $(el).text().trim()).get();

        if (title && link) {
            // Generate an ID from the slug (last part of the URL)
            const id = link.split('/').filter(Boolean).pop() || link;
            items.push({
                id,
                name: title,
                poster: poster || undefined,
                type: 'series', // we determine the exact type later in meta
            });
        }
    });

    return items;
}

// ─── META: Get detailed info + episode list for a specific anime ───
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
    // The detail URL is typically /{animeId}/ or we need to construct it from the ID
    // In your case, the ID is the slug, e.g., 'mushoku-tensei-season-3-hindi-download'
    // The full URL is https://animedrive.me/{animeId}/
    const html = await fetchHTML(`${BASE_URL}/${animeId}/`);
    const $ = cheerio.load(html);

    // Extract title – usually in h1 or a specific class
    const title = $('h1.entry-title, .anime-title, .post-title').first().text().trim();
    if (!title) {
        console.warn(`Could not find title for anime: ${animeId}`);
        return null;
    }

    // Extract poster – often in the featured image
    const poster = $('.post-thumb-img-content img, .anime-poster img, .featured-image img').first().attr('src');

    // Extract description – look for the content area
    const description = $('.entry-content p, .anime-description, .post-content p').first().text().trim();

    // Extract genres – usually in category links or meta tags
    const genre: string[] = [];
    // Look for .category a or .genres a elements
    $('.category a, .genres a, .post-categories a').each((_, element) => {
        const text = $(element).text().trim();
        if (text) genre.push(text);
    });

    // ─── Extract Episodes ───
    const episodes: Episode[] = [];

    // On the detail page, episodes are often inside a <ul> or <div> with class 'episode-list'
    // The HTML you provided shows a pattern: each episode is an <a> inside a <li>
    // We'll look for any link that contains "episode" or "watch" in its text or href
    $('#episode_related li, .episode-list li, .episodes li, .download-links li').each((_, element) => {
        const linkElement = $(element).find('a');
        const href = linkElement.attr('href');
        const epText = linkElement.text().trim();

        if (href && epText) {
            // Try to extract season and episode numbers from the text or URL
            // Common patterns: "Episode 12", "S1E12", "Season 1 Episode 12"
            let season = 1;
            let episodeNum = 1;

            const seasonMatch = epText.match(/Season\s*(\d+)/i) || href.match(/season[-\s]*(\d+)/i);
            const episodeMatch = epText.match(/Episode\s*(\d+)/i) || href.match(/episode[-\s]*(\d+)/i) || epText.match(/\b(\d{1,3})\b/);

            if (seasonMatch) season = parseInt(seasonMatch[1], 10);
            if (episodeMatch) episodeNum = parseInt(episodeMatch[1], 10);

            // Generate an ID from the href
            const id = href.split('/').filter(Boolean).pop() || href;

            episodes.push({
                season,
                episode: episodeNum,
                title: epText || `Episode ${episodeNum}`,
                id,
            });
        }
    });

    // If no episodes found via the above selectors, try another common pattern
    if (episodes.length === 0) {
        // Some sites use a table or list of links; we'll look for any link that contains "watch"
        $('a[href*="watch"], a[href*="episode"]').each((_, element) => {
            const href = $(element).attr('href');
            const epText = $(element).text().trim();
            if (href && epText) {
                const id = href.split('/').filter(Boolean).pop() || href;
                episodes.push({
                    season: 1,
                    episode: episodes.length + 1,
                    title: epText || `Episode ${episodes.length + 1}`,
                    id,
                });
            }
        });
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

// ─── STREAM: Get the video URL for a specific episode ───
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
    // The watch page URL is usually https://animedrive.me/{episode-id}/
    // or /watch/{episode-id}
    const html = await fetchHTML(`${BASE_URL}/watch/${episodeId}/`);
    const $ = cheerio.load(html);

    // Look for an iframe containing the video player
    // Common selectors: .play-video iframe, .video-container iframe, #player iframe
    const iframeSrc = $('iframe[src*="player"], iframe[src*="embed"], .play-video iframe, .video-container iframe, #player iframe').first().attr('src');
    if (iframeSrc) {
        // If the iframe src is relative, make it absolute
        if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`;
        if (iframeSrc.startsWith('/')) return `${BASE_URL}${iframeSrc}`;
        return iframeSrc;
    }

    // Fallback: look for a <video> element's source
    const videoSrc = $('video source').first().attr('src');
    if (videoSrc) return videoSrc;

    // Some sites embed the video via JavaScript; we can look for a script tag containing the video URL
    // For simplicity, we'll return null if not found
    console.warn(`Could not find stream for episode: ${episodeId}`);
    return null;
}
