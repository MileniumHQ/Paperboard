import { claimPort, prepareGamePorts, type PortDeps, type PortMove } from "../../service/ports";
import type { PortSpec } from "../serviceTypes";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { BEDROCK_PORT_NAME, JAVA_PORT_NAME, NETHERNET_PORT_NAME } from "../../core/portNames";
import { parseProperties, stringifyServerProperties } from "../../core/properties";
import type { ServerSoftwareType } from "../../software/catalog";
import { BEDROCK_PORT_SETTING_ID, CROSSPLAY, crossplaySetting, NETHERNET_PORT_SETTING_ID } from "../../software/crossplay";
import { findCrossplayJars, readBedrockTransport, settleBedrockTransport } from "../../service/crossplay";
import { serializedFileTask, writeFileAtomic } from "../../service/fileWrites";
import { writeSchemaSetting, type LoaderDeps, type LoaderFs } from "../../service/loaderSettings";

// The server's ports go through Paperboard's port registry, so no other
// panel and no other program ends up on the same one. The config files say
// which port the server wants; right before it starts, each is claimed and
// checked, and a port the registry moved is written back into its file so
// the server opens the one it was given. Turning crossplay on claims the
// Bedrock ports at once, so they are listed before the first start.

export const DEFAULT_JAVA_PORT = 25565;
const JAVA_LABEL = "Game Server (Java)";
const BEDROCK_LABEL = "Game Server (Bedrock)";
const NETHERNET_LABEL = "Game Server (Bedrock NetherNet)";


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

/**
 * Geyser's two ports, or releases when it is not installed. Lazy, in order:
 * a moved Bedrock port is in the file before NetherNet's is read.
 */
async function* geyserSpecs(software: ServerSoftwareType, deps: LoaderDeps): AsyncGenerator<PortSpec> {
    const installed = Boolean(CROSSPLAY[software]) && Boolean((await findCrossplayJars(software, deps)).geyser);
    // settled first, so NetherNet has a port of its own to claim
    if (installed) await settleBedrockTransport(software, deps);
    const read = async () => (installed ? readBedrockTransport(software, deps) : null);
    const writer = (id: string) => async (port: number) => {
        await writeSchemaSetting(CROSSPLAY[software]!.schema, crossplaySetting(id)!, String(port), deps);
    };
    yield {
        name: BEDROCK_PORT_NAME, label: BEDROCK_LABEL, protocol: "tcp+udp",
        preferred: (await read())?.bedrockPort ?? null,
        write: writer(BEDROCK_PORT_SETTING_ID),
    };
    const after = await read();
    yield {
        name: NETHERNET_PORT_NAME, label: NETHERNET_LABEL, protocol: "udp",
        // none for RakNet alone, or for NetherNet someone left sharing the Bedrock port
        preferred: after && after.transport !== "raknet" && after.nethernetPort !== 0 ? after.nethernetPort : null,
        write: writer(NETHERNET_PORT_SETTING_ID),
    };
}

/** Port identities are unchanged, including the optional claims released on removal. */
export const portNames = [JAVA_PORT_NAME, BEDROCK_PORT_NAME, NETHERNET_PORT_NAME];
export async function* portSpecs(software: ServerSoftwareType, deps: PortDeps): AsyncGenerator<PortSpec> {
    yield { name: JAVA_PORT_NAME, label: JAVA_LABEL, protocol: "tcp", preferred: await readJavaPort(deps), write: (port) => writeJavaPort(port, deps) };
    yield* geyserSpecs(software, deps);
}

/** Compatibility for callers that already know their Minecraft loader. */
export async function prepareServerPorts(software: ServerSoftwareType, deps: PortDeps): Promise<PortMove[]> {
    // Resolve in order: a Java move is persisted before reading Geyser's config.
    return prepareGamePorts(portSpecs(software, deps), deps);
}

/**
 * Bedrock players connect over UDP, RakNet on the Bedrock port and NetherNet
 * on its own; Geyser's signaling listens on TCP at the Bedrock port. Both are
 * claimed while Geyser is installed and given back once it is not.
 */
export async function claimBedrockPorts(software: ServerSoftwareType, starting: boolean, deps: PortDeps): Promise<PortMove[]> {
    const moves: PortMove[] = [];
    for await (const { name, label, protocol, preferred, write } of geyserSpecs(software, deps)) {
        if (preferred === null) {
            await deps.ports.release(name);
            continue;
        }
        const moved = await claimPort({ name, label, protocol, preferred }, write, starting, deps);
        if (moved) moves.push(moved);
    }
    return moves;
}
