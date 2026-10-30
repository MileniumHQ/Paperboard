import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { PNG } from "pngjs";
import { serializedFileTask, writeFileAtomic } from "./fileWrites";
import { SERVER_ICON_FILE, SERVER_ICON_SIZE } from "../core/serverIcon";

// The server list icon: server-icon.png in the server folder. The game only
// shows a 64×64 PNG and silently ignores anything else, so the page scales
// whatever image was picked and this checks what arrives before it
// replaces the old icon. The server reads the icon at start.

/** a 64×64 RGBA PNG is a few KB; this only stops a runaway payload */
const MAX_ICON_BYTES = 256 * 1024;

export interface ServerIconDeps {
    serverDir(): Promise<string>;
}

const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

/** the current icon as a data URL, or null when the server has none */
export async function readServerIcon(deps: ServerIconDeps): Promise<string | null> {
    const file = nodePath.join(await deps.serverDir(), SERVER_ICON_FILE);
    try {
        return dataUrl(await nodeFs.readFile(file));
    } catch (err) {
        if ((err as { code?: string } | null)?.code === "ENOENT") return null;
        throw err;
    }
}

/** replaces the icon with `png` (base64), once it proves to be a 64×64 PNG */
export async function setServerIcon(png: unknown, deps: ServerIconDeps): Promise<string> {
    if (typeof png !== "string" || png === "") throw new Error("No icon image was sent.");
    const bytes = Buffer.from(png, "base64");
    if (bytes.length > MAX_ICON_BYTES) {
        throw new Error(`The icon is ${Math.ceil(bytes.length / 1024)} KB; a server icon is at most ${MAX_ICON_BYTES / 1024} KB.`);
    }
    let image: PNG;
    try {
        image = PNG.sync.read(bytes);
    } catch (err) {
        throw new Error(`The icon isn't a readable PNG: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (image.width !== SERVER_ICON_SIZE || image.height !== SERVER_ICON_SIZE) {
        throw new Error(
            `The icon is ${image.width}×${image.height}; Minecraft only shows a ${SERVER_ICON_SIZE}×${SERVER_ICON_SIZE} icon.`,
        );
    }
    const file = nodePath.join(await deps.serverDir(), SERVER_ICON_FILE);
    await serializedFileTask(file, () => writeFileAtomic(nodeFs, file, bytes));
    return dataUrl(bytes);
}

/** deletes the icon; a server without one shows the game's default */
export async function removeServerIcon(deps: ServerIconDeps): Promise<void> {
    const file = nodePath.join(await deps.serverDir(), SERVER_ICON_FILE);
    await serializedFileTask(file, () => nodeFs.rm(file, { force: true }));
}
