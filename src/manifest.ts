import { Manifest } from 'stremio-addon-sdk';

export const manifest: Manifest = {
  id: 'org.you.animedrive',
  version: '1.0.0',
  name: 'Gogoanime Scraper',
  description: 'Watch anime from Gogoanime (anitaku.so)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  catalogs: [
    { type: 'series', id: 'gogoanime_recent' },
  ],
  background: 'https://anitaku.so/static/bg.jpg',
  logo: 'https://anitaku.so/static/logo.png',
};
