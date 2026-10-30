// The server list icon against a real temp server folder and real PNGs: only
// a 64×64 PNG replaces server-icon.png, and anything else is refused with a
// reason while the old icon stays. Removing it deletes only that file.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PNG } from "pngjs";
import { readServerIcon, removeServerIcon, setServerIcon } from "../src/service/serverIcon";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function server(): { dir: string; deps: { serverDir: () => Promise<string> } } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-icon-"));
    dirs.push(dir);
    return { dir, deps: { serverDir: async () => dir } };
}

function png(width: number, height: number, red = 255): Buffer {
    const image = new PNG({ width, height });
    for (let i = 0; i < image.data.length; i += 4) image.data.set([red, 0, 0, 255], i);
    return PNG.sync.write(image);
}

const iconPath = (dir: string) => path.join(dir, "server-icon.png");

describe("setServerIcon", () => {
    test("writes a 64×64 PNG as server-icon.png and returns it as a data URL", async () => {
        const { dir, deps } = server();
        const bytes = png(64, 64);
        const url = await setServerIcon(bytes.toString("base64"), deps);
        expect(fs.readFileSync(iconPath(dir)).equals(bytes)).toBe(true);
        expect(url).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
        expect(fs.readdirSync(dir)).toEqual(["server-icon.png"]);
    });

    test("refuses another size and keeps the old icon", async () => {
        const { dir, deps } = server();
        const old = png(64, 64, 10);
        fs.writeFileSync(iconPath(dir), old);
        await expect(setServerIcon(png(128, 128).toString("base64"), deps)).rejects.toThrow(
            "The icon is 128×128; Minecraft only shows a 64×64 icon.",
        );
        expect(fs.readFileSync(iconPath(dir)).equals(old)).toBe(true);
    });

    test("refuses bytes that aren't a PNG", async () => {
        const { dir, deps } = server();
        await expect(setServerIcon(Buffer.from("GIF89a nope").toString("base64"), deps)).rejects.toThrow(
            "The icon isn't a readable PNG",
        );
        expect(fs.existsSync(iconPath(dir))).toBe(false);
    });

    test("refuses an empty request", async () => {
        const { deps } = server();
        await expect(setServerIcon(undefined, deps)).rejects.toThrow("No icon image was sent.");
        await expect(setServerIcon("", deps)).rejects.toThrow("No icon image was sent.");
    });
});

describe("readServerIcon", () => {
    test("is null when the server has no icon", async () => {
        const { deps } = server();
        expect(await readServerIcon(deps)).toBeNull();
    });

    test("returns the icon on disk as a data URL", async () => {
        const { dir, deps } = server();
        const bytes = png(64, 64);
        fs.writeFileSync(iconPath(dir), bytes);
        expect(await readServerIcon(deps)).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    });

    test("a server folder that can't be read is an error, not a missing icon", async () => {
        const { dir, deps } = server();
        fs.mkdirSync(iconPath(dir));
        await expect(readServerIcon(deps)).rejects.toThrow();
    });
});

describe("removeServerIcon", () => {
    test("deletes server-icon.png and leaves the rest of the folder", async () => {
        const { dir, deps } = server();
        fs.writeFileSync(iconPath(dir), png(64, 64));
        fs.writeFileSync(path.join(dir, "server.properties"), "motd=hi\n");
        await removeServerIcon(deps);
        expect(fs.readdirSync(dir)).toEqual(["server.properties"]);
        expect(await readServerIcon(deps)).toBeNull();
    });

    test("is done already when there is no icon", async () => {
        const { dir, deps } = server();
        await removeServerIcon(deps);
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});
