import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { PortClaim, PortRequest } from "@mileniumhq/paperapi";
import { BEDROCK_PORT_NAME, JAVA_PORT_NAME } from "../core/portNames";
import { parseProperties, stringifyServerProperties } from "../core/properties";
import type { ServerSoftwareType } from "../software/catalog";
import { BEDROCK_PORT_SETTING_ID, CROSSPLAY, crossplaySetting } from "../software/crossplay";
import { findCrossplayJars } from "./crossplay";
import { serializedFileTask, writeFileAtomic } from "./fileWrites";
import { readSchemaSettings, writeSchemaSetting, type LoaderDeps, type LoaderFs } from "./loaderSettings";

// The server's ports go through Paperboard's port registry, so no other
// panel and no other program ends up on the same one. The config files say
// which port the server wants; right before it starts, each is claimed and
// checked, and a port the registry moved is written back into its file so
// the server opens the one it was given. Turning crossplay on claims the
// Bedrock port at once, so it is listed before the first start.

export const DEFAULT_JAVA_PORT = 25565;
const JAVA_LABEL = "Game Server (Java)";
const BEDROCK_LABEL = "Game Server (Bedrock)";

export interface PortRegistryDeps {
    claim(request: PortRequest): Promise<PortClaim>;
    prepare(name: string): Promise<PortClaim>;
    release(name: string): Promise<void>;
}

export interface PortDeps extends LoaderDeps {
    ports: PortRegistryDeps;
}

/** a port the registry gave in place of the one the file asked for */
export interface PortMove {
    label: string;
    from: number;
    to: number;
}

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

/**
 * Claims the port the file asks for and writes back a moved one. `starting`
 * also checks the computer right now; only then, since a running server
 * holds its own ports.
 */
async function claimPort(
    request: PortRequest,
    write: (port: number) => Promise<void>,
    starting: boolean,
    deps: PortDeps,
): Promise<PortMove | null> {
    let { port } = await deps.ports.claim(request);
    if (starting) port = (await deps.ports.prepare(request.name)).port;
    if (port === request.preferred) return null;
    await write(port);
    return { label: request.label, from: request.preferred, to: port };
}

/**
 * Right before the server starts: the Java port, and the Bedrock port while
 * Geyser is installed (released once it is not). Throws, with the reason,
 * when a port is taken and the user's setting refuses to move it.
 */
export async function prepareServerPorts(software: ServerSoftwareType, deps: PortDeps): Promise<PortMove[]> {
    const moves: PortMove[] = [];
    const java = await claimPort(
        { name: JAVA_PORT_NAME, label: JAVA_LABEL, protocol: "tcp", preferred: await readJavaPort(deps) },
        (port) => writeJavaPort(port, deps),
        true,
        deps,
    );
    if (java) moves.push(java);
    const bedrock = await claimBedrockPort(software, true, deps);
    if (bedrock) moves.push(bedrock);
    return moves;
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
