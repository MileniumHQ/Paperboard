import type { GameArt } from "./types";
/** Where scripts/fetch-game-art.ts puts a game's art; the panel never fetches art at runtime. */
export const gameArt = (id: string): GameArt => ({
    poster: `/assets/games/${id}/poster.webp`,
    banner: `/assets/games/${id}/banner.webp`,
});
