import type { GameArt } from "./types";
const taglines: Readonly<Record<string, string>> = {
    minecraft: "Create! Explore! Survive!",
    terraria: "Dig, fight, explore, build!",
    "counter-strike-2": "An elite competitive experience.",
    "team-fortress-2": "The most fun you can have online.",
    "garrys-mod": "We give you the tools and leave you to play.",
    palworld: "Don't worry; there are no labor laws for Pals.",
    rust: "Do whatever it takes to last another night.",
};
/**
 * Where scripts/fetch-game-art.ts puts a game's art; the panel never fetches art at runtime.
 * Relative to the panel's folder, not the host's root: a browser host serves the panel from
 * /_panel/<computer>/<panel>/, where a leading slash would land on the shell's own files.
 */
export const gameArt = (id: string): GameArt => ({
    tagline: taglines[id] ?? (() => { throw new Error(`No tagline for game "${id}"`); })(),
    poster: `assets/games/${id}/poster.webp`,
    banner: `assets/games/${id}/banner.webp`,
    icon: `assets/games/${id}/icon.webp`,
});
