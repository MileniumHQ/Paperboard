/** Bundled game metadata. Safe to import in renderers and widgets. */
export interface GameOptions {
    settings?: Readonly<Record<string, unknown>>;
    software: string;
    version: string;
}
export type Control = { kind: "none" } | { kind: "stdin" };
export interface PackageRequirement {
    id: string;
    purpose: string;
}
export interface GameTab {
    id: string;
    label: string;
    icon: string;
    group?: string;
    owner: "shared" | "game";
    variant?: "fill" | "full";
    width?: "full";
}
export interface GameFeatures {
    control: Control;
    tabs: readonly GameTab[];
    actions: readonly string[];
    widgets: readonly string[];
    packages: readonly PackageRequirement[];
}
/** Art under public/assets/games/<id>/, fetched once by scripts/fetch-game-art.ts. */
export interface GameArt {
    tagline: string;
    /** Portrait (2:3) cover. */
    poster: string;
    /** Wide band, about 3:1. */
    banner: string;
}
export interface GameDefinition {
    id: string;
    name: string;
    art: GameArt;
    describe(options: GameOptions): GameFeatures;
    softwareLabel(options: GameOptions): string;
}
