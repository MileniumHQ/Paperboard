/** Bundled game metadata. Safe to import in renderers and widgets. */
export interface GameOptions {
    settings?: Readonly<Record<string, unknown>>;
    software: string;
    version: string;
}
/**
 * What the console line under a running server does. "stdin": console
 * commands, written to the server's input. "rcon": console commands, sent
 * by the game service over its remote console. "broadcast": the game has no
 * console; the line is a message to everyone on the server. "none": the
 * console only shows output.
 */
export type Control = { kind: "none" } | { kind: "stdin" } | { kind: "rcon" } | { kind: "broadcast" };
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
    /**
     * The variant on a phone, where it differs: "page" for a tab that fills
     * the screen beside a menu but is too tall for a phone's, such as an
     * Overview with its console, so it scrolls as a whole there.
     */
    compactVariant?: "page";
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
    /** A number picked on a range, shown with its unit ("10 chunks"); whole numbers unless `step` says otherwise; marks are the ticks under it. */
    | { kind: "slider"; min: number; max: number; step?: number; unit: string; marks?: readonly number[]; default?: number }
    | { kind: "boolean"; default?: boolean }
    | { kind: "select"; choices: readonly { value: string; label: string }[]; default?: string }
    /** noun: what the secret is, for its empty and set field ("token"); a password otherwise */
    | { kind: "secret"; noun?: string }
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
    /** The calls this game, with this software and version, answers. */
    calls: readonly string[];
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
