import { claimPort, prepareGamePorts, type PortDeps, type PortMove, type RunPorts } from "../../service/ports";
import type { PortSpec } from "../serviceTypes";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { BEDROCK_PORT_NAME, JAVA_PORT_NAME, NETHERNET_PORT_NAME } from "../../core/portNames";
import { parseProperties, stringifyServerProperties } from "../../core/properties";
import type { ServerSoftwareType } from "../../software/catalog";
import { BEDROCK_PORT_SETTING_ID, CROSSPLAY, crossplaySetting, NETHERNET_PORT_SETTING_ID } from "../../software/crossplay";
import { findCrossplayJars, readBedrockTransport, settleBedrockTransport } from "../../service/crossplay";
import { serializedFileTask } from "../../service/fileWrites";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { writeSchemaSetting, type LoaderDeps, type LoaderFs } from "../../service/loaderSettings";
import { unlessMissing } from "../../service/failures";

// The server's ports go through Paperboard's port registry, so no other
// panel and no other program ends up on the same one. The config files say
// which port the server wants; right before it starts, each is claimed and
// checked. A Java port the registry moved is this run's alone: the launch
// passes it as --port. Paper and the servers built on it save that into
// server.properties as they start and whenever they save their settings, so
// while the run lasts the file's port is read as the user's, and once it ends
// the user's is put back. Geyser reads
// its ports only from its config, so those are pinned. Turning crossplay on
// claims the Bedrock ports at once, so they are listed before the first
// start, and the ports it was given are written into Geyser's config then.

export const DEFAULT_JAVA_PORT = 25565;
// each follows the server's name in Paperboard's port list: "Survival · Minecraft"
const JAVA_LABEL = "Minecraft";
const BEDROCK_LABEL = "Minecraft Bedrock";
const NETHERNET_LABEL = "Minecraft Bedrock NetherNet";


function fsOf(deps: LoaderDeps): LoaderFs {
    return deps.fs ?? (nodeFs as unknown as LoaderFs);
}

async function propertiesPath(deps: LoaderDeps): Promise<string> {
    return nodePath.join(await deps.serverDir(), "server.properties");
}

/** the port server.properties asks for; the server's own default when it names none */
export async function readJavaPort(deps: LoaderDeps): Promise<number> {
    const text = await unlessMissing(fsOf(deps).readFile(await propertiesPath(deps), "utf8"), null);
    if (text === null) return DEFAULT_JAVA_PORT;
    const port = Number(parseProperties(text)["server-port"]?.trim());
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_JAVA_PORT;
}

// the Java port is claimed first, so it is the one players join on
const javaMove = (moves: readonly PortMove[]) => moves.find((move) => move.primary);

/** server.properties' port as the user chose it: the run's own, which a moved run's server wrote there, reads as the one it moved from. */
export function chosenJavaPort(port: string | undefined, moves: readonly PortMove[]): string | undefined {
    const move = javaMove(moves);
    return move && port?.trim() === String(move.to) ? String(move.from) : port;
}

/** After a moved run, puts the user's port back where the server wrote the run's over it; any other port there is the user's and stays. */
export async function restoreJavaPort(moves: readonly PortMove[], deps: LoaderDeps): Promise<void> {
    const move = javaMove(moves);
    if (!move) return;
    const fs = fsOf(deps);
    const file = await propertiesPath(deps);
    await serializedFileTask(file, async () => {
        const text = await unlessMissing(fs.readFile(file, "utf8"), null);
        if (text === null) return;
        const props = parseProperties(text);
        if (props["server-port"]?.trim() !== String(move.to)) return;
        await writeFileAtomic(file, stringifyServerProperties({ ...props, "server-port": String(move.from) }));
    });
}

const PINNED = "Choose another port in Crossplay, or close the program using it.";

/**
 * Geyser's two ports, or releases when it is not installed. Lazy, in order:
 * a Bedrock port moved as crossplay is turned on is in the file before
 * NetherNet's is read.
 */
async function* geyserSpecs(software: ServerSoftwareType, deps: LoaderDeps): AsyncGenerator<PortSpec & { setting: string }> {
    const installed = Boolean(CROSSPLAY[software]) && Boolean((await findCrossplayJars(software, deps)).geyser);
    // settled first, so NetherNet has a port of its own to claim
    if (installed) await settleBedrockTransport(software, deps);
    const read = async () => (installed ? readBedrockTransport(software, deps) : null);
    yield {
        name: BEDROCK_PORT_NAME, label: BEDROCK_LABEL, protocol: "tcp+udp", pinned: PINNED, setting: BEDROCK_PORT_SETTING_ID,
        preferred: (await read())?.bedrockPort ?? null,
    };
    const after = await read();
    yield {
        name: NETHERNET_PORT_NAME, label: NETHERNET_LABEL, protocol: "udp", pinned: PINNED, setting: NETHERNET_PORT_SETTING_ID,
        // none for RakNet alone, or for NetherNet someone left sharing the Bedrock port
        preferred: after && after.transport !== "raknet" && after.nethernetPort !== 0 ? after.nethernetPort : null,
    };
}

/** Port identities are unchanged, including the optional claims released on removal. */
export const portNames = [JAVA_PORT_NAME, BEDROCK_PORT_NAME, NETHERNET_PORT_NAME];
export async function* portSpecs(software: ServerSoftwareType, deps: PortDeps): AsyncGenerator<PortSpec> {
    yield { name: JAVA_PORT_NAME, label: JAVA_LABEL, protocol: "tcp", preferred: await readJavaPort(deps) };
    yield* geyserSpecs(software, deps);
}

/** Compatibility for callers that already know their Minecraft loader. */
export async function prepareServerPorts(software: ServerSoftwareType, deps: PortDeps): Promise<RunPorts> {
    return prepareGamePorts(portSpecs(software, deps), deps);
}

/**
 * Bedrock players connect over UDP, RakNet on the Bedrock port and NetherNet
 * on its own; Geyser's signaling listens on TCP at the Bedrock port. Turning
 * crossplay on claims both while Geyser is installed, and writes the ports
 * it was given into Geyser's config; they are given back once it is not.
 */
export async function claimBedrockPorts(software: ServerSoftwareType, deps: PortDeps): Promise<void> {
    for await (const { name, label, protocol, preferred, setting } of geyserSpecs(software, deps)) {
        if (preferred === null) {
            await deps.ports.release(name);
            continue;
        }
        const port = await claimPort({ name, label, protocol, preferred }, false, deps);
        if (port !== preferred) await writeSchemaSetting(CROSSPLAY[software]!.schema, crossplaySetting(setting)!, String(port), deps);
    }
}
