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
    { type: 'movie', id: 'animedrive_movies' },
  ],
  background: 'https://animedrive.me/static/bg.jpg',
  logo: 'https://animedrive.me/static/logo.png',
};
