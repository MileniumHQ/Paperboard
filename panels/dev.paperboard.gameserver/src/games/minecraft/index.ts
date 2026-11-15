import semver from "semver";
import type { GameDefinition, GameOptions, GameTab } from "../types";
import { gameArt } from "../art";
import { AUTOMATION_TAB } from "../automation";
import { SOFTWARE, type ServerSoftwareType } from "../../software/catalog";
import { CROSSPLAY } from "../../software/crossplay";
import { MODPACK_LOADER } from "../../core/modpack";
import { versionSupports, type CapabilityName } from "../../lib/versionProfile";
import { SOFTWARE_NAMES, getRequiredJavaVersion } from "../../lib/software";
import { minecraftOptions } from "./options";
import { MINECRAFT_CALLS, type CallName } from "../../service/contract";

export function minecraftSoftware(value: string): ServerSoftwareType {
    if (!Object.hasOwn(SOFTWARE, value)) throw new Error(`Unsupported Minecraft software: ${value}`);
    return value as ServerSoftwareType;
}
const tab = (id: string, label: string, icon: string, group?: string, extra: Partial<GameTab> = {}): GameTab =>
    ({ id, label, icon, group, owner: "game", ...extra });

export const minecraft: GameDefinition = {
    id: "minecraft",
    name: "Minecraft",
    art: gameArt("minecraft"),
    icon: "grass",
    hostSupport: () => ({ supported: true }),
    softwareLabel: ({ software, version }) => `${SOFTWARE_NAMES[minecraftSoftware(software)]} ${version}`,
    describe({ software: raw, version }: GameOptions) {
        const software = minecraftSoftware(raw);
        const ready = (cap: CapabilityName) => !semver.coerce(version) || versionSupports(version, cap);
        const tabs: GameTab[] = [
            tab("overview", "Overview", "dashboard", undefined, { variant: "fill", compactVariant: "page" }),
            tab("chat", "Chat", "chat", "Play", { variant: "fill" }),
            ...(ready("playerStats") ? [tab("players", "Players", "group", "Play", { variant: "fill", width: "full" })] : []),
            ...(ready("mapRendering") ? [tab("map", "Map", "map", "Play", { variant: "full" })] : []),
            ...(CROSSPLAY[software] ? [tab("crossplay", "Crossplay", "devices", "Play")] : []),
            ...(ready("worldManager") ? [tab("worlds", "Worlds", "public", "World")] : []),
            tab("gamerules", "Game Rules", "list_alt_check", "World"),
            ...(ready("datapacks") ? [tab("datapacks", "Datapacks", "dataset", "World")] : []),
            tab("resourcepack", "Resource Pack", "texture", "World"),
            tab("versions", "Versions", "deployed_code", "Software"),
            ...(software !== "vanilla" ? [tab("loader", "Loader", "settings_applications", "Software")] : []),
            ...(SOFTWARE[software].addons ? [tab("plugins", SOFTWARE[software].addons?.kind === "mod" ? "Mods" : "Plugins", "extension", "Software")] : []),
            ...(MODPACK_LOADER[software] ? [tab("modpacks", "Modpacks", "package_2", "Software")] : []),
            tab("options", "Options", "tune", "Server", { owner: "shared" }),
            tab("files", "Files", "folder", "Server", { owner: "shared", variant: "fill" }),
            tab("logs", "Logs", "description", "Server", { owner: "shared", variant: "fill" }),
            tab("backups", "Backups", "backup", "Server", { owner: "shared" }),
            AUTOMATION_TAB,
            tab("advanced", "Advanced", "settings", "Server", { owner: "shared" }),
        ];
        // Roster/moderation remains supported independently of the statistics tab.
        // Call names stay stable; optional game features are checked here
        // as well as in their file/console adapters.
        const unavailable = new Set<CallName>();
        if (!ready("mapRendering")) for (const id of ["listMapRegions", "renderMapTile"] as const) unavailable.add(id);
        if (!ready("datapacks")) for (const id of ["listDatapacks", "listDatapackVersions", "installDatapack", "removeDatapack", "uploadDatapacks"] as const) unavailable.add(id);
        if (!CROSSPLAY[software]) for (const id of ["readCrossplay", "writeCrossplaySetting", "prepareCrossplay"] as const) unavailable.add(id);
        // Read-only discovery can still report an empty/unsupported view (Versions
        // counts the previous loader's add-ons before a switch). Mutations cannot.
        if (!SOFTWARE[software].addons) for (const id of ["deletePlugin", "uninstallAllPlugins", "uploadPlugins", "locateAddonConfig"] as const) unavailable.add(id);
        if (!MODPACK_LOADER[software]) for (const id of ["listModpackVersions", "installModpack", "removeModpack", "uploadModpack"] as const) unavailable.add(id);
        if (software === "vanilla") for (const id of ["writeLoaderSetting"] as const) unavailable.add(id);
        if (!ready("playerStats")) unavailable.add("listPlayerStats");
        const java = getRequiredJavaVersion(version);
        return {
            options: minecraftOptions(version),
            optionsWhileRunning: "next-start",
            backupWhileRunning: "quiesce",
            control: { kind: "stdin" },
            tabs,
            calls: MINECRAFT_CALLS.filter((id) => !unavailable.has(id)),
            widgets: ["status", "players", "console", "motd"],
            packages: java ? [{ id: java, purpose: "Minecraft Java runtime" }] : [],
            nameBook: "usercache.json",
        };
    },
};
