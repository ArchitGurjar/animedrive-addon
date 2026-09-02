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
