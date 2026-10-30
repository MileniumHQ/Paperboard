import type { GameArt } from "./types";
const taglines: Readonly<Record<string, string>> = {
    minecraft: "Create! Explore! Survive!",
    terraria: "Dig, fight, explore, build!",
    "counter-strike-2": "Counter-Strike offers an elite competitive experience.",
    "team-fortress-2": "Nine distinct classes provide a broad range of tactical abilities and personalities.",
    "garrys-mod": "Garry's Mod is a physics sandbox.",
    palworld: "Fight, farm, build and work alongside mysterious creatures called Pals!",
    "ark-survival-ascended": "ARK is reimagined with Unreal Engine 5!",
};
/** Where scripts/fetch-game-art.ts puts a game's art; the panel never fetches art at runtime. */
export const gameArt = (id: string): GameArt => ({
    tagline: taglines[id] ?? (() => { throw new Error(`No tagline for game "${id}"`); })(),
    poster: `/assets/games/${id}/poster.webp`,
    banner: `/assets/games/${id}/banner.webp`,
});
