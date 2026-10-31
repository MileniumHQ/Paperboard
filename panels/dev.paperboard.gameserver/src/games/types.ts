/** Bundled game metadata. Safe to import in renderers and widgets. */
export interface GameOptions {
    settings?: Readonly<Record<string, unknown>>;
    software: string;
    version: string;
}
/**
 * What the console line under a running server does. "stdin": console
 * commands. "broadcast": the game has no console; the line is a message to
 * everyone on the server. "none": the console only shows output.
 */
export type Control = { kind: "none" } | { kind: "stdin" } | { kind: "broadcast" };
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
type OptionBase = {
    id: string;
    label: string;
    description?: string;
    restartRequired: boolean;
    /**
     * Where the option is edited instead of Options. "world": applies when a
     * world is generated, so New World asks for it. "overview": the game's
     * Overview edits it, as Terraria's message of the day.
     */
    scope?: "world" | "overview";
    /** Options sharing a section are listed together under its title, after the unsectioned ones. */
    section?: OptionSection;
    /** The shared options tab that lists it, such as "advanced"; "options" when unset. */
    tab?: string;
};
export interface OptionSection {
    title: string;
    description?: string;
}
export type GameOption = OptionBase & (
    | { kind: "text"; maxLength?: number; default?: string }
    /** `step` below 1 allows decimals in that step, as a 0.1 multiplier; whole numbers otherwise. */
    | { kind: "number"; min: number; max: number; step?: number; default?: number }
    /** A whole number picked on a range, shown with its unit ("10 chunks"); marks are the ticks under it. */
    | { kind: "slider"; min: number; max: number; unit: string; marks?: readonly number[]; default?: number }
    | { kind: "boolean"; default?: boolean }
    | { kind: "select"; choices: readonly { value: string; label: string }[]; default?: string }
    | { kind: "secret" }
);
export interface GameFeatures {
    options: readonly GameOption[];
    /**
     * What a running server does with an option edit. "locked": options are
     * edited while it is stopped. "next-start": edits are saved at once; an
     * option with restartRequired false applies at once, the rest when the
     * server next starts.
     */
    optionsWhileRunning: "locked" | "next-start";
    /**
     * What a backup does to a running server, matching its service's backup
     * mode. "quiesce": it keeps running with saving paused for the copy.
     * "offline": it is saved, stopped for the copy and started again.
     */
    backupWhileRunning: "quiesce" | "offline";
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
    /** The game's square app icon. */
    icon: string;
}
export interface GameDefinition {
    id: string;
    name: string;
    art: GameArt;
    icon: string;
    hostSupport(host: { os: string; arch: string }, options: GameOptions): { supported: boolean; reason?: string };
    describe(options: GameOptions): GameFeatures;
    softwareLabel(options: GameOptions): string;
}
