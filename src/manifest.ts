// src/manifest.ts
import { Manifest } from 'stremio-addon-sdk';

export const manifest: Manifest = {
  id: 'org.you.desidubanime',
  version: '1.0.0',
  name: 'DesiDubAnime Scraper',
  description: 'Watch Indian regional dubbed anime from desidubanime.me',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  catalogs: [
    { type: 'series', id: 'desidubanime_popular' },
    { type: 'movie', id: 'desidubanime_movies' },
  ],
  background: 'https://www.desidubanime.me/static/bg.jpg',
  logo: 'https://www.desidubanime.me/static/logo.png',
};
