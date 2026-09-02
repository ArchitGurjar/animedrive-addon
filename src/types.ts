// src/types.ts
export interface AnimeItem {
  id: string;
  name: string;
  poster?: string;
  type: string;
}

export interface Episode {
  season: number;
  episode: number;
  title: string;
  id: string;
}

export interface MetaDetails {
  id: string;
  name: string;
  poster?: string;
  type: string;
  description?: string;
  genre?: string[];
  episodes?: Episode[];
}

export interface Stream {
  url: string;
  title?: string;
  name?: string;
  description?: string;
  behaviorHints?: {
    proxyHeaders?: {
      request?: Record<string, string>;
    };
    headers?: Record<string, string>;
  };
}
