// Some names come with their own look (see CHARACTERS in the contract). A
// skin paints the face's sphere, which is otherwise invisible, and its
// features.

import { characterOf, type Character } from "../contract";

export interface FaceSkin {
    /** the sphere's fill */
    sphere: string;
    /** the features' fill */
    ink: string;
}

const SKINS: Record<Character, FaceSkin> = {
    // Verity, the yellow smiley helper from ThatMob's Minecraft ARG
    verity: { sphere: "var(--paper-face-verity)", ink: "var(--paper-face-verity-ink)" },
};

/** The skin an agent's name brings, if any. */
export const skinFor = (name: string | null | undefined): FaceSkin | null => {
    const c = characterOf(name);
    return c ? SKINS[c] : null;
};
