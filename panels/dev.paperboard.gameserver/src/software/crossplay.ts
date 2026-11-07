import type { ServerSoftwareType } from "./catalog";
import type { LoaderFile, LoaderSetting, LoaderSettingsSchema } from "./loaderSettings";

// Crossplay: Geyser lets Bedrock players join, Floodgate lets them in
// without a Java account. Both are ordinary add-ons; this table says where
// each comes from on every software that can run them, what the jars call
// themselves (a filename is not a name) and which of their settings the
// Crossplay tab shows. Keys and defaults were read from the files Geyser
// 2.12.1 (b1276) and Floodgate 2.2.5 (b141) wrote on a real Paper server.
// Both accept a partial config.yml and fill in the rest on start, so their
// files are seeded: settings can be changed before the first start.

export const GEYSER_MODRINTH_ID = "wKkoqHrH";
export const FLOODGATE_MODRINTH_ID = "bWrNNfkb";

/** where Floodgate comes from: Modrinth only carries the modded builds */
export type FloodgateSource =
    | { kind: "modrinth"; projectId: typeof FLOODGATE_MODRINTH_ID }
    | { kind: "geysermc"; project: "floodgate"; platform: "spigot"; filename: string };

export interface CrossplayPlatform {
    /** the name inside the jar: a plugin's `name` or a mod's id */
    geyserName: string;
    floodgateName: string;
    floodgate: FloodgateSource;
    schema: LoaderSettingsSchema;
}

export const DEFAULT_BEDROCK_PORT = 19132;

function files(geyserDir: string, floodgateDir: string): LoaderFile[] {
    return [
        { id: "geyser", format: "yaml", label: "Geyser", locations: () => [`${geyserDir}/config.yml`], seeded: true },
        { id: "floodgate", format: "yaml", label: "Floodgate", locations: () => [`${floodgateDir}/config.yml`], seeded: true },
    ];
}

const SETTINGS: LoaderSetting[] = [
    {
        id: "geyser.port",
        file: "geyser",
        path: ["bedrock", "port"],
        title: "Bedrock port",
        description: "Where Bedrock players connect. To play from outside your network, forward it over UDP and TCP.",
        control: "number",
        min: 1,
        max: 65535,
        defaultValue: String(DEFAULT_BEDROCK_PORT),
    },
    {
        id: "geyser.webrtc-port",
        file: "geyser",
        path: ["bedrock", "webrtc-port"],
        title: "NetherNet port",
        description: "Where newer Bedrock versions connect. To play from outside your network, forward it over UDP.",
        control: "number",
        min: 1,
        max: 65535,
        // Geyser's own: 0 shares the Bedrock port, which "both" cannot
        defaultValue: "0",
    },
    {
        id: "geyser.server-name",
        file: "geyser",
        path: ["gameplay", "server-name"],
        title: "Server name",
        description: "Shown to Bedrock players in the pause and settings menus.",
        control: "text",
        maxLength: 32,
        defaultValue: "Geyser",
    },
    {
        id: "geyser.passthrough-motd",
        file: "geyser",
        path: ["motd", "passthrough-motd"],
        title: "Same MOTD as Java",
        description: "Bedrock players see the server's own message in their server list.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "geyser.show-coordinates",
        file: "geyser",
        path: ["gameplay", "show-coordinates"],
        title: "Show coordinates",
        description: "Bedrock players see where they are, like Java's debug screen.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "geyser.cooldown-type",
        file: "geyser",
        path: ["gameplay", "cooldown-type"],
        title: "Attack cooldown",
        description: "Where Bedrock players see the attack cooldown Java combat has.",
        control: "select",
        options: [
            { value: "crosshair", label: "Under the crosshair" },
            { value: "hotbar", label: "Above the hotbar" },
            { value: "disabled", label: "Hidden" },
        ],
        defaultValue: "crosshair",
    },
    {
        id: "geyser.emotes",
        file: "geyser",
        path: ["gameplay", "emotes-enabled"],
        title: "Emotes",
        description: "Bedrock players see each other's emotes.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "geyser.command-suggestions",
        file: "geyser",
        path: ["gameplay", "command-suggestions"],
        title: "Command suggestions",
        description: "Turn this off if Bedrock players freeze the first time they open chat on a server with many commands.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "geyser.xbox-achievements",
        file: "geyser",
        path: ["gameplay", "xbox-achievements-enabled"],
        title: "Xbox achievements",
        description: "Bedrock players can unlock achievements. Unknown commands then tell them cheats are off.",
        control: "toggle",
        defaultValue: "false",
    },
    {
        id: "floodgate.username-prefix",
        file: "floodgate",
        path: ["username-prefix"],
        title: "Username prefix",
        description: "Put in front of Bedrock names so one never matches a Java player's.",
        control: "text",
        maxLength: 16,
        defaultValue: ".",
    },
    {
        id: "floodgate.replace-spaces",
        file: "floodgate",
        path: ["replace-spaces"],
        title: "Replace spaces in names",
        description: "Bedrock names can have spaces and Java names can't, so spaces become underscores.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "floodgate.global-linking",
        file: "floodgate",
        path: ["player-link", "enable-global-linking"],
        title: "Linked accounts",
        description: "Players who linked their Java and Bedrock accounts with GeyserMC play as their Java account.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        id: "floodgate.require-link",
        file: "floodgate",
        path: ["player-link", "require-link"],
        title: "Require a linked account",
        description: "Only Bedrock players who linked a Java account can join.",
        control: "toggle",
        defaultValue: "false",
    },
];

/**
 * Turning crossplay on sets this: Bedrock players log in through Floodgate
 * instead of needing a Java account. Not shown; it is what crossplay means.
 */
export const AUTH_TYPE_SETTING: LoaderSetting = {
    id: "geyser.auth-type",
    file: "geyser",
    path: ["java", "auth-type"],
    title: "Bedrock login",
    description: "",
    control: "select",
    options: [{ value: "floodgate", label: "Floodgate" }],
    defaultValue: "online",
};

/**
 * How Bedrock players connect. Geyser's default is "nethernet" alone, which
 * turns away every client still connecting over RakNet, so crossplay sets
 * "both", each on its own UDP port. Not shown: "raknet" is only for someone
 * editing the file, and stays as they set it.
 */
export const TRANSPORT_SETTING: LoaderSetting = {
    id: "geyser.transport",
    file: "geyser",
    path: ["bedrock", "transport"],
    title: "Bedrock transport",
    description: "",
    control: "select",
    options: [
        { value: "both", label: "NetherNet and RakNet" },
        { value: "nethernet", label: "NetherNet" },
        { value: "raknet", label: "RakNet" },
    ],
    defaultValue: "nethernet",
};

export const BEDROCK_PORT_SETTING_ID = "geyser.port";
export const NETHERNET_PORT_SETTING_ID = "geyser.webrtc-port";

// Forge has no Geyser build; Vanilla has no add-ons at all
export const CROSSPLAY: Readonly<Partial<Record<ServerSoftwareType, CrossplayPlatform>>> = {
    paper: {
        geyserName: "Geyser-Spigot",
        floodgateName: "floodgate",
        floodgate: { kind: "geysermc", project: "floodgate", platform: "spigot", filename: "floodgate-spigot.jar" },
        schema: { files: files("plugins/Geyser-Spigot", "plugins/floodgate"), settings: SETTINGS },
    },
    fabric: {
        geyserName: "geyser-fabric",
        floodgateName: "floodgate",
        floodgate: { kind: "modrinth", projectId: FLOODGATE_MODRINTH_ID },
        schema: { files: files("config/Geyser-Fabric", "config/floodgate"), settings: SETTINGS },
    },
    neoforge: {
        geyserName: "geyser_neoforge",
        floodgateName: "floodgate",
        floodgate: { kind: "modrinth", projectId: FLOODGATE_MODRINTH_ID },
        schema: { files: files("config/Geyser-NeoForge", "config/floodgate"), settings: SETTINGS },
    },
};

export function crossplaySetting(id: unknown): LoaderSetting | null {
    return SETTINGS.find((setting) => setting.id === id) ?? null;
}
