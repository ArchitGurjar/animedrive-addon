// src/manifest.ts
import { Manifest } from 'stremio-addon-sdk';

export const manifest: Manifest = {
  id: 'org.you.desidubanime',
  version: '1.0.0',
  name: 'DesiDubAnime Scraper',
  description: 'Watch Indian regional dubbed anime from desidubanime.me',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series'],
  catalogs: [
    { type: 'series', id: 'desidubanime_all' },      // Full A‑Z list
    // { type: 'series', id: 'desidubanime_popular' }, // optional
  ],
  background: 'https://www.desidubanime.me/wp-content/uploads/2025/01/Logoo.png',
  logo: 'https://www.desidubanime.me/wp-content/uploads/2025/01/Logoo.png',
};
