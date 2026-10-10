// The static facts about every server software the panel can run: what it
// is called, how it looks in a picker, where its add-ons live and how its
// worlds are laid out. Pure data with no network or SDK imports, so the UI,
// the service and versionProfile can all read it without import cycles.
//
// Adding a software means one entry here plus one provider in
// src/software/providers.ts (how to list versions, resolve a build and
// install it). TypeScript refuses a provider table or picker that misses an
// id listed here.

export const SOFTWARE_IDS = ["vanilla", "paper", "fabric", "neoforge", "forge"] as const;

export type ServerSoftwareType = (typeof SOFTWARE_IDS)[number];

export type WorldLayout = "dimensions" | "bukkit-split" | "vanilla-split";

/** Where a software's add-ons come from and where they are installed. */
export interface AddonEcosystem {
    /** what the UI calls one add-on */
    kind: "plugin" | "mod";
    /** folder under the server directory the software loads them from */
    dir: "plugins" | "mods";
    /** Modrinth `project_type` facet */
    projectType: "plugin" | "mod";
    /** Modrinth loader id: the `categories:` facet and a version's `loaders` entry */
    modrinthLoader: string;
}

// src: a full-color logo (pixelated for pixel art that would blur when
// scaled); mask: a single-color logo whose shape is drawn in the text color,
// so it reads on light and dark themes; symbol: a Material Symbols name.
export type SoftwareIcon = { src: string; pixelated?: boolean } | { mask: string } | { symbol: string };

export interface SoftwareInfo {
    id: ServerSoftwareType;
    name: string;
    /** one-sentence picker description */
    description: string;
    icon: SoftwareIcon;
    /** null when the software has no add-on system */
    addons: AddonEcosystem | null;
    /** world directory layout before version-specific overrides apply */
    worldLayout: WorldLayout;
    /** the picker's default choice */
    recommended?: boolean;
}

const MODS = (modrinthLoader: string): AddonEcosystem => ({
    kind: "mod",
    dir: "mods",
    projectType: "mod",
    modrinthLoader,
});

export const SOFTWARE: Readonly<Record<ServerSoftwareType, SoftwareInfo>> = {
    vanilla: {
        id: "vanilla",
        name: "Vanilla",
        description:
            "Official Mojang release. Straight from the source, but suffers from performance issues and has no plugin or mod support.",
        icon: { symbol: "deployed_code" },
        addons: null,
        worldLayout: "vanilla-split",
    },
    paper: {
        id: "paper",
        name: "Paper",
        description:
            "Vast plugin support and high performance, but makes opinionated changes to some game mechanics.",
        icon: { src: "/assets/paper.png" },
        addons: { kind: "plugin", dir: "plugins", projectType: "plugin", modrinthLoader: "paper" },
        worldLayout: "bukkit-split",
        recommended: true,
    },
    fabric: {
        id: "fabric",
        name: "Fabric",
        description:
            "Lightweight mod loader. Limited traditional plugin support, and does not improve performance out of the box.",
        icon: { src: "/assets/fabric.png" },
        addons: MODS("fabric"),
        worldLayout: "vanilla-split",
    },
    neoforge: {
        id: "neoforge",
        name: "NeoForge",
        description:
            "Mod loader for large content mods and most modern modpacks.",
        icon: { src: "/assets/neoforge.png", pixelated: true },
        addons: MODS("neoforge"),
        worldLayout: "vanilla-split",
    },
    forge: {
        id: "forge",
        name: "Forge",
        description:
            "The original mod loader. Needed for older modpacks and mods that never moved to NeoForge.",
        icon: { mask: "/assets/forge.png" },
        addons: MODS("forge"),
        worldLayout: "vanilla-split",
    },
};

export function isServerSoftware(value: unknown): value is ServerSoftwareType {
    return typeof value === "string" && (SOFTWARE_IDS as readonly string[]).includes(value);
}

export function softwareName(id: ServerSoftwareType): string {
    return SOFTWARE[id].name;
}
