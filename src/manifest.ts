// src/scraper.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeItem, MetaDetails, Episode } from './types';

// Use the stable Gogoanime domain
const BASE_URL = 'https://anitaku.so';

// Helper: Fetch HTML with robust headers to avoid blocking
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

// ----- CATALOG: Recently added anime (from homepage) -----
export async function getRecentAnime(): Promise<AnimeItem[]> {
    const html = await fetchHTML(`${BASE_URL}/home`);
    const $ = cheerio.load(html);
    const items: AnimeItem[] = [];

    // Selector for the "Recent Anime" section on the homepage
    $('.last_episodes li').each((_, element) => {
        const titleElement = $(element).find('.name a');
        const title = titleElement.text().trim();
        const link = titleElement.attr('href');
        const poster = $(element).find('img').attr('src');

        if (title && link) {
            // Extract the anime ID from the URL, e.g., "/category/naruto"
            const id = link.replace('/category/', '').replace('/', '');
            items.push({
                id,
                name: title,
                poster: poster || undefined,
                type: 'series',
            });
        }
    });

    return items;
}

// ----- META: Detailed anime info + episode list -----
export async function getAnimeDetails(animeId: string): Promise<MetaDetails | null> {
    const html = await fetchHTML(`${BASE_URL}/category/${animeId}`);
    const $ = cheerio.load(html);

    const title = $('.anime_info_body_bg h1').text().trim();
    if (!title) {
        console.warn(`Could not find title for anime: ${animeId}`);
        return null;
    }

    const poster = $('.anime_info_body_bg img').attr('src');
    const description = $('.anime_info_body_bg .description').text().trim();
    
    // Extract genres
    const genre: string[] = [];
    $('.anime_info_body_bg .genre a').each((_, element) => {
        genre.push($(element).text().trim());
    });

    // Extract episodes from the episode list
    const episodes: Episode[] = [];
    $('#episode_related li').each((_, element) => {
        const link = $(element).find('a').attr('href');
        const epText = $(element).find('a .name').text().trim();
        // The episode number is usually the last part of the text (e.g., "Episode 12")
        const episodeMatch = epText.match(/\d+$/);
        if (link && episodeMatch) {
            const episodeNum = parseInt(episodeMatch[0], 10);
            // Gogoanime episodes are generally season 1 by default
            const id = link.replace('/watch/', '').replace('/', '');
            episodes.push({
                season: 1,
                episode: episodeNum,
                title: `Episode ${episodeNum}`,
                id,
            });
        }
    });

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

// ----- STREAM: Get the video URL for a specific episode -----
export async function getEpisodeStream(episodeId: string): Promise<string | null> {
    const html = await fetchHTML(`${BASE_URL}/watch/${episodeId}`);
    const $ = cheerio.load(html);

    // Gogoanime often loads the video via an iframe.
    // The iframe source usually points to a video host.
    const iframeSrc = $('iframe').attr('src');
    if (iframeSrc) {
        // If the iframe is from a known player, we might need to follow it.
        // For simplicity, we return the iframe URL.
        return iframeSrc;
    }

    // Fallback: Look for a 'video' element's source.
    const videoSrc = $('video source').attr('src');
    if (videoSrc) {
        return videoSrc;
    }

    console.warn(`Could not find stream for episode: ${episodeId}`);
    return null;
}
