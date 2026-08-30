// src/types.ts
export interface AnimeItem {
  id: string;
  name: string;
  poster?: string;
  type: "movie" | "series";
  year?: string;
}

export interface Episode {
  season: number;
  episode: number;
  title?: string;
  id: string;          // unique identifier for the stream endpoint
}

export interface MetaDetails extends AnimeItem {
  description?: string;
  genre?: string[];
  episodes: Episode[];
}
