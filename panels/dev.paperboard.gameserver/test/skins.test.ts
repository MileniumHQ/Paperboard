// Player heads (bun test): the real service/skins.ts with a local HTTP
// server answering for Mojang and the texture CDN the way the real ones do.
// Nothing is kept between lookups: a changed skin shows on the next one. Only
// the daemon's file API is replaced.
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PNG } from "pngjs";

mock.module("../src/service/api", () => {
    const files = { read: async () => null, write: async () => "", exists: async () => false, getPath: async (p: string) => p };
    return { config: { get: async () => null, set: async () => true }, files, fileApi: files, system: {}, processApi: {} };
});

const JAVA = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

// one flat colour per texture, so a head says which skin it was cut from
const colours = new Map<string, [number, number, number]>([
    ["a1a1a1", [200, 0, 0]],
]);
function skinPng([r, g, b]: [number, number, number]): Uint8Array {
    const png = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
    }
    // a transparent hat, so the face fills the head
    for (let y = 8; y < 16; y++) for (let x = 40; x < 48; x++) png.data[(y * 64 + x) * 4 + 3] = 0;
    return PNG.sync.write(png);
}

const requests: string[] = [];
const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        const tail = pathname.slice(pathname.lastIndexOf("/") + 1);
        if (pathname.startsWith("/session/session/minecraft/profile/")) {
            if (tail !== JAVA.replace(/-/g, "")) return new Response(null, { status: 204 });
            const textures = { textures: { SKIN: { url: "http://textures.minecraft.net/texture/a1a1a1" } } };
            return Response.json({ id: tail, name: "Notch", properties: [{ name: "textures", value: Buffer.from(JSON.stringify(textures)).toString("base64") }] });
        }
        if (pathname.startsWith("/textures/texture/")) {
            const colour = colours.get(tail);
            return colour ? new Response(skinPng(colour), { headers: { "content-type": "image/png" } }) : new Response(null, { status: 404 });
        }
        return new Response(null, { status: 404 });
    },
});
const realFetch = globalThis.fetch;
const ORIGINS: Record<string, string> = {
    "https://sessionserver.mojang.com": "/session",
    "https://api.mojang.com": "/mojang",
    "https://textures.minecraft.net": "/textures",
};
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const base = ORIGINS[url.origin];
    if (base === undefined) throw new Error(`Unexpected origin: ${url.origin}`);
    return realFetch(new URL(base + url.pathname + url.search, upstream.url), init);
}) as typeof fetch;
afterAll(() => {
    globalThis.fetch = realFetch;
    upstream.stop(true);
});

const { getHeadDataUrl } = await import("../src/service/skins");

function centre(dataUrl: string | null): number[] {
    expect(dataUrl).toStartWith("data:image/png;base64,");
    const png = PNG.sync.read(Buffer.from(dataUrl!.slice(dataUrl!.indexOf(",") + 1), "base64"));
    const i = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

beforeEach(() => {
    requests.length = 0;
    colours.set("a1a1a1", [200, 0, 0]);
});

describe("player heads", () => {
    it("cuts a Java player's head from their Mojang skin", async () => {
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA }))).toEqual([200, 0, 0]);
        expect(requests).toEqual([`/session/session/minecraft/profile/${JAVA.replace(/-/g, "")}`, "/textures/texture/a1a1a1"]);
    });

    it("asks again on every lookup, so a changed skin shows at once", async () => {
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA }))).toEqual([200, 0, 0]);
        colours.set("a1a1a1", [0, 200, 0]);
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA }))).toEqual([0, 200, 0]);
        expect(requests).toHaveLength(4);
    });
});
