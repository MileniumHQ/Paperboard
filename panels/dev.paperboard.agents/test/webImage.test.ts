import { describe, expect, test } from "bun:test";
import { fetchWebImage, WEB_IMAGE_BYTES, type WebResponse } from "../src/service/webImage";

// a 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64");

const NAMES: Record<string, string[]> = {
    "images.example": ["93.184.216.34"],
    "cdn.example": ["1.1.1.1"],
    "intranet.example": ["10.1.2.3"],
    "rebind.example": ["127.0.0.1"],
    "router.example": ["192.168.1.1"],
};
const lookup = async (h: string) => {
    const found = NAMES[h];
    if (!found) throw new Error(`the test resolves no ${h}`);
    return found.map((address) => ({ address }));
};

/** A web that answers from `pages` by URL, and records every request: the address dialed and the URL asked for. */
function web(pages: Record<string, { status?: number; headers?: Record<string, string>; body?: Buffer }>) {
    const asked: { address: string; url: string }[] = [];
    const get = async (address: string, url: URL): Promise<WebResponse> => {
        asked.push({ address, url: url.href });
        const page = pages[url.href];
        if (!page) throw new Error(`the test serves no ${url.href}`);
        const body = page.body ?? Buffer.alloc(0);
        return {
            status: page.status ?? 200,
            headers: { "content-length": String(body.length), ...page.headers },
            body: (async function* () {
                yield body;
            })(),
            close: () => {},
        };
    };
    return { asked, deps: { lookup, get } };
}

// A web image an agent's message names is loaded by the service under the browser's network rule, never by the page.
describe("a web image in a message", () => {
    test("this computer and its local network are refused before anything is dialed, by name or by number", async () => {
        const w = web({});
        for (const url of [
            "https://127.0.0.1/a.png",
            "https://[::1]/a.png",
            "https://[::ffff:127.0.0.1]/a.png",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.0.0.1/a.png",
            "https://intranet.example/a.png",
            "https://rebind.example/a.png",
            "https://router.example:8443/a.png",
        ]) {
            await expect(fetchWebImage(url, w.deps)).rejects.toThrow(/private or local|this computer or its local network/);
        }
        expect(w.asked).toEqual([]);
    });

    test("a public one is fetched from the address that was checked, and a redirect is checked again", async () => {
        const w = web({
            "https://images.example/cat.png": { headers: { "content-type": "image/png" }, body: PNG },
            "https://images.example/moved": { status: 302, headers: { location: "https://cdn.example/cat.png" } },
            "https://cdn.example/cat.png": { headers: { "content-type": "image/png" }, body: PNG },
            "https://images.example/sneaky": { status: 301, headers: { location: "https://intranet.example/admin.png" } },
        });
        expect(await fetchWebImage("https://images.example/cat.png", w.deps)).toEqual({ type: "image/png", data: PNG.toString("base64") });
        expect(w.asked).toEqual([{ address: "93.184.216.34", url: "https://images.example/cat.png" }]);
        await fetchWebImage("https://images.example/moved", w.deps);
        expect(w.asked.slice(1)).toEqual([
            { address: "93.184.216.34", url: "https://images.example/moved" },
            { address: "1.1.1.1", url: "https://cdn.example/cat.png" },
        ]);
        await expect(fetchWebImage("https://images.example/sneaky", w.deps)).rejects.toThrow("on this computer or its local network");
        expect(w.asked.at(-1)!.url).toBe("https://images.example/sneaky");
    });

    test("only HTTPS pictures within the size cap whose bytes are a picture", async () => {
        const w = web({
            "https://images.example/page": { headers: { "content-type": "text/html" }, body: Buffer.from("<html>") },
            "https://images.example/fake.png": { headers: { "content-type": "image/png" }, body: Buffer.from("<svg onload=alert(1)>") },
            "https://images.example/huge.png": { headers: { "content-type": "image/png", "content-length": String(WEB_IMAGE_BYTES + 1) }, body: PNG },
            "https://images.example/endless.png": { headers: { "content-type": "image/png", "content-length": "" }, body: Buffer.alloc(WEB_IMAGE_BYTES + 1) },
            "https://images.example/gone.png": { status: 404 },
        });
        await expect(fetchWebImage("http://images.example/cat.png", w.deps)).rejects.toThrow("only pictures on https://");
        await expect(fetchWebImage("https://user:pw@images.example/cat.png", w.deps)).rejects.toThrow("user name or password");
        await expect(fetchWebImage("file:///etc/passwd", w.deps)).rejects.toThrow("only pictures on https://");
        await expect(fetchWebImage("https://images.example/page", w.deps)).rejects.toThrow("didn't send a picture");
        await expect(fetchWebImage("https://images.example/fake.png", w.deps)).rejects.toThrow("isn't a PNG");
        await expect(fetchWebImage("https://images.example/huge.png", w.deps)).rejects.toThrow("it's over 8 MB");
        await expect(fetchWebImage("https://images.example/endless.png", w.deps)).rejects.toThrow("it's over 8 MB");
        await expect(fetchWebImage("https://images.example/gone.png", w.deps)).rejects.toThrow("answered 404");
    });
});
