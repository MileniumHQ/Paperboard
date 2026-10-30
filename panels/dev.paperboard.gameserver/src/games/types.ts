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
type OptionBase = { id: string; label: string; description?: string; restartRequired: boolean };
export type GameOption = OptionBase & (
    | { kind: "text"; default?: string }
    | { kind: "number"; min: number; max: number; default?: number }
    | { kind: "boolean"; default?: boolean }
    | { kind: "select"; choices: readonly { value: string; label: string }[]; default?: string }
    | { kind: "secret" }
);
export interface GameFeatures {
    options: readonly GameOption[];
    control: Control;
    tabs: readonly GameTab[];
    actions: readonly string[];
    widgets: readonly string[];
    packages: readonly PackageRequirement[];
}
export interface GameDefinition {
    id: string;
    name: string;
    icon: string;
    hostSupport(host: { os: string; arch: string }, options: GameOptions): { supported: boolean; reason?: string };
    describe(options: GameOptions): GameFeatures;
    softwareLabel(options: GameOptions): string;
}
