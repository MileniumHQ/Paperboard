// Pictures from elsewhere (a wiki's map thumbnails, Workshop previews, add-on
// icons) reach a page only as the bytes the service fetched: the page never
// loads an address it was handed, and the service refuses what isn't a
// public picture from the hosts its source uses.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { loopbackServer } from "./helpers/http";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { TF2 } from "../src/games/tf2";
import { MAX_PICTURE_BYTES, PICTURE_HOSTS, servedPicture } from "../src/service/pictures";

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
    const listed = [new URL(host.url).host];

    test("a listed host's picture comes back as a data: address of what its bytes are", async () => {
        expect(await servedPicture(`${host.url}/icon.png`, listed, "Test")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
        expect(await servedPicture(`${host.url}/unnamed`, listed, "Test")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    });

    test("what isn't a public picture from the source's hosts is refused", async () => {
        await expect(servedPicture(`${host.url}/page.html`, listed, "Test")).rejects.toThrow("Test sent text/html where a picture should be");
        await expect(servedPicture(`${host.url}/huge.png`, listed, "Test")).rejects.toThrow("is over 8 MB");
        await expect(servedPicture("https://elsewhere.example/icon.png", listed, "Test")).rejects.toThrow("Test keeps its pictures on");
        // any public host is no address on this computer or its network
        await expect(servedPicture(`${host.url}/other.png`, null, "Test")).rejects.toThrow("is a private or local address");
        await expect(servedPicture("file:///etc/passwd", null, "Test")).rejects.toThrow("not file:");
    });
});

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";

describe("a page shows remote pictures", () => {
    test("only as the service fetched them, never by loading their addresses", async () => {
        // stand-ins for the Official Team Fortress Wiki and Steam's picture host
        const wikiPage = fs.readFileSync(path.join(import.meta.dir, "fixtures", "tfwiki-list-of-maps.html"), "utf8");
        const wiki = loopbackServer((_req, url) => (url.pathname === "/wiki/List_of_maps" ? new Response(wikiPage, { headers: { "content-type": "text/html" } }) : png()));
        const steam = loopbackServer(() => png());
        Object.assign(TF2, { mapPictures: { name: "Official Team Fortress Wiki", page: `${wiki.url}/wiki/List_of_maps` } });
        PICTURE_HOSTS["steam-workshop"]!.push(new URL(steam.url).host);

        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        const workshopMaps = [{ id: "454116880", title: "Discovery", previewImageUrl: `${steam.url}/ugc/454116880/`, tags: ["Arena"], subscribers: 12, updated: 0 }];
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-tf", name: "Payload", game: TF2.id, directory: `${SERVERS}/s-tf`, createdAt: 0, settings: { configured: true, workshopMaps } }] }));
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-tf", "install"), {
            [`steamapps/appmanifest_${TF2.appId}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${TF2.appId}"\n\t"buildid"\t\t"19000000"\n}\n`,
            "tf/maps/ctf_2fort.bsp": "", "tf/maps/pl_badwater.bsp": "",
            "tf/cfg/mapcycle.txt": "ctf_2fort\npl_badwater\n",
        });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-tf`);
        // every address the page asks for that isn't its own: the panel's files and the daemon's socket are
        const elsewhere: string[] = [];
        const own = [served.url, `ws://127.0.0.1:${daemon.port}`];
        page.on(({ method, params }) => {
            const url: string | undefined = method === "Network.requestWillBeSent" ? params.request.url : method === "Network.webSocketCreated" ? params.url : undefined;
            if (url && !url.startsWith("data:") && !own.some((origin) => url.startsWith(origin))) elsewhere.push(url);
        });
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="maps"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="maps"]');
            // each row's picture, as its list item draws it
            const pictures = (list: string) => `[...document.querySelectorAll('input[name=${list}]')].flatMap((input) => [...input.parentElement.querySelectorAll("img")])`;
            await page.waitFor(`${pictures("source-map-cycle")}.length === 2 && ${pictures("source-workshop-maps")}.length === 1`, "the maps' pictures");
            const sources = await page.evaluate<string[]>(`[...${pictures("source-map-cycle")}, ...${pictures("source-workshop-maps")}].map((img) => img.src)`);
            expect(sources).toEqual(Array(3).fill(`data:image/png;base64,${PNG.toString("base64")}`));
            expect(wiki.requests).toContain("/wiki/List_of_maps");
            expect(steam.requests).toEqual(["/ugc/454116880/"]);
            expect(elsewhere).toEqual([]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
