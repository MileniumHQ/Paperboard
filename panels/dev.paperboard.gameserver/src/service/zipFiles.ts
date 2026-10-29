import * as nodeFs from "node:fs/promises";

// A zip begins "PK\x03\x04" (or "PK\x05\x06" when it has no entries). A share
// page or an error text saved under a .jar name begins with neither, and
// reading it as an archive would report an empty one rather than a wrong file.
const LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06];

export async function assertZipFile(path: string, label: string): Promise<void> {
    const handle = await nodeFs.open(path, "r");
    try {
        const head = new Uint8Array(4);
        const { bytesRead } = await handle.read(head, 0, 4, 0);
        const is = (magic: number[]) => bytesRead === 4 && magic.every((byte, i) => head[i] === byte);
        if (!is(LOCAL_HEADER) && !is(EMPTY_ARCHIVE)) throw new Error(`${label} is not a zip file`);
    } finally {
        await handle.close();
    }
}
