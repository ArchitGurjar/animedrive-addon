// src/manifest.ts
import { Manifest } from 'stremio-addon-sdk';

export const manifest: Manifest = {
  id: 'org.you.animedrive',
  version: '1.0.0',
  name: 'AnimeDrive Scraper',
  description: 'Watch anime from animedrive.me',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  catalogs: [
    { type: 'series', id: 'animedrive_popular' },
    // Add more catalogs if needed (e.g., movies)
  ],
  // Optional – replace with actual images if available
  background: 'https://animedrive.me/wp-content/uploads/2026/07/animedrive-logo-fixed.png',
  logo: 'https://animedrive.me/wp-content/uploads/2026/07/animedrive-logo-fixed.png',
};
