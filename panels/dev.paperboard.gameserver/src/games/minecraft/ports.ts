import { claimPort, prepareGamePorts, type PortDeps, type PortMove } from "../../service/ports";
import type { PortSpec } from "../serviceTypes";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { BEDROCK_PORT_NAME, JAVA_PORT_NAME } from "../../core/portNames";
import { parseProperties, stringifyServerProperties } from "../../core/properties";
import type { ServerSoftwareType } from "../../software/catalog";
import { BEDROCK_PORT_SETTING_ID, CROSSPLAY, crossplaySetting } from "../../software/crossplay";
import { findCrossplayJars } from "../../service/crossplay";
import { serializedFileTask, writeFileAtomic } from "../../service/fileWrites";
import { readSchemaSettings, writeSchemaSetting, type LoaderDeps, type LoaderFs } from "../../service/loaderSettings";

// The server's ports go through Paperboard's port registry, so no other
// panel and no other program ends up on the same one. The config files say
// which port the server wants; right before it starts, each is claimed and
// checked, and a port the registry moved is written back into its file so
// the server opens the one it was given. Turning crossplay on claims the
// Bedrock port at once, so it is listed before the first start.

export const DEFAULT_JAVA_PORT = 25565;
const JAVA_LABEL = "Game Server (Java)";
const BEDROCK_LABEL = "Game Server (Bedrock)";


function fsOf(deps: LoaderDeps): LoaderFs {
    return deps.fs ?? (nodeFs as unknown as LoaderFs);
}

async function propertiesPath(deps: LoaderDeps): Promise<string> {
    return nodePath.join(await deps.serverDir(), "server.properties");
}

/** the port server.properties asks for; the server's own default when it names none */
export async function readJavaPort(deps: LoaderDeps): Promise<number> {
    let text: string;
    try {
        text = await fsOf(deps).readFile(await propertiesPath(deps), "utf8");
    } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return DEFAULT_JAVA_PORT;
        throw err;
    }
    const port = Number(parseProperties(text)["server-port"]?.trim());
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_JAVA_PORT;
}

async function writeJavaPort(port: number, deps: LoaderDeps): Promise<void> {
    const fs = fsOf(deps);
    const file = await propertiesPath(deps);
    await serializedFileTask(file, async () => {
        let text = "";
        try {
            text = await fs.readFile(file, "utf8");
        } catch (err) {
            if ((err as { code?: string }).code !== "ENOENT") throw err;
        }
        await writeFileAtomic(fs, file, stringifyServerProperties({ ...parseProperties(text), "server-port": String(port) }));
    });
}

/** the port Geyser is set to, or null when Geyser is not installed */
async function readBedrockPort(software: ServerSoftwareType, deps: LoaderDeps): Promise<number | null> {
    const platform = CROSSPLAY[software];
    if (!platform || !(await findCrossplayJars(software, deps)).geyser) return null;
    const { groups } = await readSchemaSettings(platform.schema, deps);
    const group = groups.find((g) => g.settings.some((s) => s.id === BEDROCK_PORT_SETTING_ID));
    if (group?.error) throw new Error(`Could not read the Bedrock port from ${group.path}: ${group.error}`);
    const value = group?.settings.find((s) => s.id === BEDROCK_PORT_SETTING_ID)?.value;
    if (value === undefined) throw new Error("Geyser's config has no Bedrock port.");
    return Number(value);
}

/** Port identities are unchanged, including the optional claim released on removal. */
export const portNames = [JAVA_PORT_NAME, BEDROCK_PORT_NAME];
export async function* portSpecs(software: ServerSoftwareType, deps: PortDeps): AsyncGenerator<PortSpec> {
    yield { name: JAVA_PORT_NAME, label: JAVA_LABEL, protocol: "tcp", preferred: await readJavaPort(deps), write: (port) => writeJavaPort(port, deps) };
    yield await bedrockSpec(software, deps);
}
async function bedrockSpec(software: ServerSoftwareType, deps: PortDeps): Promise<PortSpec> {
    const preferred = await readBedrockPort(software, deps);
    return {
        name: BEDROCK_PORT_NAME, label: BEDROCK_LABEL, protocol: "tcp+udp", preferred,
        write: async (port) => {
            await writeSchemaSetting(CROSSPLAY[software]!.schema, crossplaySetting(BEDROCK_PORT_SETTING_ID)!, String(port), deps);
        },
    };
}
/** Compatibility for callers that already know their Minecraft loader. */
export async function prepareServerPorts(software: ServerSoftwareType, deps: PortDeps): Promise<PortMove[]> {
    // Resolve in order: a Java move is persisted before reading Geyser's config.
    return prepareGamePorts(portSpecs(software, deps), deps);
}

/** Bedrock players connect over UDP; Geyser also listens on TCP at the same port */
export async function claimBedrockPort(software: ServerSoftwareType, starting: boolean, deps: PortDeps): Promise<PortMove | null> {
    const preferred = await readBedrockPort(software, deps);
    if (preferred === null) {
        await deps.ports.release(BEDROCK_PORT_NAME);
        return null;
    }
    const schema = CROSSPLAY[software]!.schema;
    return claimPort(
        { name: BEDROCK_PORT_NAME, label: BEDROCK_LABEL, protocol: "tcp+udp", preferred },
        async (port) => {
            await writeSchemaSetting(schema, crossplaySetting(BEDROCK_PORT_SETTING_ID)!, String(port), deps);
        },
        starting,
        deps,
    );
}
