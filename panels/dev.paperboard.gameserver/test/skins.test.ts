// Player heads (bun test): the real service/skins.ts with a local HTTP
// server answering for Mojang, GeyserMC's global API and the texture CDN the
// way the real ones do (checked with curl: skin/<xuid> → {texture_id, ...},
// or {} when GeyserMC holds no skin). A Java uuid's skin comes from Mojang, a
// Floodgate uuid's from GeyserMC. A texture URL is a hash of the skin, so a
// changed skin is a new URL: heads are kept by URL, and which skin a player
// wears is asked again after a minute. Only the daemon's file API is replaced.
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test";
import { PNG } from "pngjs";

mock.module("../src/service/api", () => {
    const files = { read: async () => null, write: async () => "", exists: async () => false, getPath: async (p: string) => p };
    return { config: { get: async () => null, set: async () => true }, files, fileApi: files, system: {}, processApi: {} };
});

const JAVA = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const TIM_XUID = "2535432196048835";
const TIM = "00000000-0000-0000-0009-01f64f65c7c3";

// one flat colour per texture, so a head says which skin it was cut from
const colours = new Map<string, [number, number, number]>([
    ["a1a1a1", [200, 0, 0]],
    ["5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38", [0, 0, 200]],
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

let javaTexture = "a1a1a1";
let bedrockSkins = new Map<string, string>([[TIM_XUID, "5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38"]]);
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
            const textures = { textures: { SKIN: { url: `http://textures.minecraft.net/texture/${javaTexture}` } } };
            return Response.json({ id: tail, name: "Notch", properties: [{ name: "textures", value: Buffer.from(JSON.stringify(textures)).toString("base64") }] });
        }
        if (pathname.startsWith("/geysermc/v2/skin/")) {
            const texture = bedrockSkins.get(tail);
            return Response.json(texture ? { hash: "h", is_steve: false, signature: "s", texture_id: texture, value: "v" } : {});
        }
        if (pathname.startsWith("/geysermc/v2/xbox/xuid/")) {
            return tail === "Tim203"
                ? Response.json({ xuid: Number(TIM_XUID) })
                : Response.json({ message: "Unable to find user in our cache" }, { status: 503 });
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
    "https://api.geysermc.org": "/geysermc",
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

const crossplay = async () => ({ prefix: ".", replaceSpaces: true });
const noCrossplay = async () => null;

function centre(dataUrl: string | null): number[] {
    expect(dataUrl).toStartWith("data:image/png;base64,");
    const png = PNG.sync.read(Buffer.from(dataUrl!.slice(dataUrl!.indexOf(",") + 1), "base64"));
    const i = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

// every test starts a minute after the last, so no skin is still fresh
let clock = Date.parse("2026-10-30T00:00:00Z");
beforeEach(() => {
    clock += 120_000;
    setSystemTime(new Date(clock));
    javaTexture = "a1a1a1";
    requests.length = 0;
    bedrockSkins = new Map([[TIM_XUID, "5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38"]]);
    colours.set("a1a1a1", [200, 0, 0]);
    colours.set("5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38", [0, 0, 200]);
    colours.set("b2b2b2", [0, 200, 0]);
});
afterEach(() => setSystemTime());

describe("player heads", () => {
    it("cuts a Java player's head from their Mojang skin", async () => {
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay }))).toEqual([200, 0, 0]);
        expect(requests).toEqual([`/session/session/minecraft/profile/${JAVA.replace(/-/g, "")}`, "/textures/texture/a1a1a1"]);
    });

    it("cuts a Bedrock player's head from the skin GeyserMC holds for their XUID", async () => {
        expect(centre(await getHeadDataUrl({ name: ".Tim203", uuid: TIM, naming: crossplay }))).toEqual([0, 0, 200]);
        expect(requests).toEqual([`/geysermc/v2/skin/${TIM_XUID}`, "/textures/texture/5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38"]);
    });

    it("finds a Bedrock player known only by name through their gamertag", async () => {
        expect(centre(await getHeadDataUrl({ name: ".Tim203", naming: crossplay }))).toEqual([0, 0, 200]);
        expect(requests[0]).toBe("/geysermc/v2/xbox/xuid/Tim203");
    });

    it("is null when GeyserMC holds no skin for the player", async () => {
        bedrockSkins.clear();
        expect(await getHeadDataUrl({ name: ".Tim203", uuid: TIM, naming: crossplay })).toBeNull();
    });

    it("shows a changed skin within a minute", async () => {
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay }))).toEqual([200, 0, 0]);
        javaTexture = "b2b2b2";
        setSystemTime(new Date(clock + 60_000));
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay }))).toEqual([0, 200, 0]);
    });

    it("draws a head it has drawn before without asking for the skin again", async () => {
        // a skin no earlier test drew
        javaTexture = "c3c3c3";
        colours.set("c3c3c3", [90, 90, 90]);
        await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay });
        setSystemTime(new Date(clock + 30_000));
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay }))).toEqual([90, 90, 90]);
        // past the minute the profile is asked again; the same skin is not downloaded again
        setSystemTime(new Date(clock + 60_000));
        expect(centre(await getHeadDataUrl({ name: "Notch", uuid: JAVA, naming: noCrossplay }))).toEqual([90, 90, 90]);
        const profile = `/session/session/minecraft/profile/${JAVA.replace(/-/g, "")}`;
        expect(requests).toEqual([profile, "/textures/texture/c3c3c3", profile]);
    });

    it("shares one lookup between everything drawing the same player at once", async () => {
        const drawn = await Promise.all([1, 2, 3].map(() => getHeadDataUrl({ name: ".Tim203", uuid: TIM, naming: crossplay })));
        expect(drawn.map(centre)).toEqual([[0, 0, 200], [0, 0, 200], [0, 0, 200]]);
        expect(requests.filter((r) => r.startsWith("/geysermc/v2/skin/"))).toHaveLength(1);
    });

    it("asks again after a lookup that found nothing", async () => {
        bedrockSkins.clear();
        expect(await getHeadDataUrl({ name: ".Tim203", uuid: TIM, naming: crossplay })).toBeNull();
        bedrockSkins.set(TIM_XUID, "5a82069695be4bb61de2bda14a51e531347b60942a1d265358be77a3e8e2dd38");
        expect(centre(await getHeadDataUrl({ name: ".Tim203", uuid: TIM, naming: crossplay }))).toEqual([0, 0, 200]);
    });
});
