// Pictures from elsewhere (a wiki's map thumbnails, Workshop previews, add-on
// icons) are fetched by the service, which refuses anything that isn't a
// public picture from the hosts its source uses.
import { describe, expect, test } from "bun:test";
import { loopbackServer, trustLoopback } from "./helpers/http";
import { MAX_PICTURE_BYTES, servedPicture } from "../src/service/pictures";

// A 1×1 PNG, the shape every picture here takes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const png = () => new Response(PNG, { headers: { "content-type": "image/png" } });

describe("the service's pictures", () => {
    const host = loopbackServer((_req, url) => {
        if (url.pathname === "/page.html") return new Response("<html></html>", { headers: { "content-type": "text/html" } });
        if (url.pathname === "/huge.png") return new Response(new Uint8Array(MAX_PICTURE_BYTES + 1), { headers: { "content-type": "image/png" } });
        // Steam calls some of its pictures this
        if (url.pathname === "/unnamed") return new Response(PNG, { headers: { "content-type": "application/octet-stream" } });
        return png();
    });
    trustLoopback(host);
    const listed = [new URL(host.url).host];
    // a server on this computer the test doesn't stand in for a public host with
    const inside = loopbackServer(() => png());

    test("a listed host's picture comes back as a data: address of what its bytes are", async () => {
        expect(await servedPicture(`${host.url}/icon.png`, listed, "Test")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
        expect(await servedPicture(`${host.url}/unnamed`, listed, "Test")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    });

    test("what isn't a public picture from the source's hosts is refused", async () => {
        await expect(servedPicture(`${host.url}/page.html`, listed, "Test")).rejects.toThrow("Test sent text/html where a picture should be");
        await expect(servedPicture(`${host.url}/huge.png`, listed, "Test")).rejects.toThrow("is over 8 MB");
        await expect(servedPicture("https://elsewhere.example/icon.png", listed, "Test")).rejects.toThrow("Test keeps its pictures on");
        // any public host is no address on this computer or its network
        await expect(servedPicture(`${inside.url}/other.png`, null, "Test")).rejects.toThrow("is a private or local address");
        await expect(servedPicture(`${inside.url}/other.png`, [new URL(inside.url).host], "Test")).rejects.toThrow("is a private or local address");
        await expect(servedPicture("file:///etc/passwd", null, "Test")).rejects.toThrow("not file:");
    });
});
