// Steam players' profile pictures in the Players tab, in the panel as a person
// uses it: Team Fortress 2's `[U:1:n]` ids, Garry's Mod's `STEAM_0:y:z` ids,
// Rust's 17-digit ids and Palworld's `steam_` ids all ask the service for the
// player's picture. Stand-ins are Steam Community (its profile XML, measured
// against the real one) and its avatar host; the page gets the picture's
// bytes and never an address.
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { loopbackServer, trustLoopback } from "./helpers/http";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { TF2 } from "../src/games/tf2";
import { GMOD } from "../src/games/gmod";
import { rust as RUST } from "../src/games/rust";
import { palworld as PALWORLD } from "../src/games/palworld";
import { steamAccount } from "../src/games/steam/steamAccount";
import { parseProfile, requireAccount, steamAvatar, STEAM_AVATAR_HOSTS, STEAM_COMMUNITY } from "../src/service/steamAvatars";

/** A 1×1 PNG of one colour: each player's picture is told from the others by it. */
const picture = (red: number, green: number, blue: number): Buffer => {
    const png = new PNG({ width: 1, height: 1 });
    png.data = Buffer.from([red, green, blue, 255]);
    return PNG.sync.write(png);
};
const RED = picture(255, 0, 0);
const GREEN = picture(0, 255, 0);
const BLUE = picture(0, 0, 255);
const YELLOW = picture(255, 255, 0);
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

/** an account's 17-digit id from its number */
const id64 = (number: number) => String(76561197960265728n + BigInt(number));

/** A profile as steamcommunity.com/profiles/<id>/?xml=1 writes it (a friends-only one has the same picture in it). */
const profile = (account: string, avatar: string, privacy = "public") =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>\n\t<steamID64>${account}</steamID64>\n\t<steamID><![CDATA[Someone]]></steamID>\n\t<onlineState>offline</onlineState>\n\t<privacyState>${privacy}</privacyState>\n\t<avatarIcon><![CDATA[${avatar}.jpg]]></avatarIcon>\n\t<avatarMedium><![CDATA[${avatar}_medium.jpg]]></avatarMedium>\n\t<avatarFull><![CDATA[${avatar}_full.jpg]]></avatarFull>\n\t<vacBanned>0</vacBanned>\n</profile>`;
const NOT_FOUND = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><error><![CDATA[The specified profile could not be found.]]></error></response>`;
// an account number nobody holds gets this HTML page, with a 200 status, from the real Steam
const NO_ACCOUNT = `<!DOCTYPE html><html><head><title>Steam Community :: Error</title></head><body><div class="error_ctn">\n\t<div id="BG_top"><div id="mainContents"><h2>Error</h2></div></div>\n\t<div id="BG_bottom"><div id="message"><h1>Sorry!</h1><p class="sectionText">An error was encountered while processing your request:<br><br></p>\n\t\t\t<h3>Failed loading profile data, please try again later.</h3><br><br></div></div></div></body></html>`;
const xml = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8" } });

// Steam's avatar host's stand-in: a picture by name (one of them not a picture until a test mends it)
let broken = true;
// the status Steam Community answers every profile with while a test says it is failing
let steamFails: number | null = null;
const avatars = loopbackServer((_req, url) => {
    // a picture is each size's, `<name>_medium.jpg` and `<name>_full.jpg`
    const [, name, size] = /^\/(\w+?)_(medium|full)\.jpg$/.exec(url.pathname) ?? [];
    if (name === "broken" && broken) return new Response("<html>not a picture</html>", { headers: { "content-type": "text/html" } });
    if (name === "boom") return new Response("Internal error", { status: 500 });
    const byName: Record<string, Buffer> = { alice: RED, bob: GREEN, dave: BLUE, broken: YELLOW, rust: GREEN, pal: BLUE, gmod: YELLOW, crowd: RED };
    const png = size ? byName[name!] : undefined;
    return png ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }) : new Response("no such picture", { status: 404 });
});
const AVATAR = (name: string) => `${avatars.url}/${name}`;
const profiles: Record<string, () => Response> = {
    [id64(1001)]: () => xml(profile(id64(1001), AVATAR("alice"))),
    // friends-only: Steam still shows the picture
    [id64(1002)]: () => xml(profile(id64(1002), AVATAR("bob"), "friendsonly")),
    // an account nobody holds
    [id64(1003)]: () => new Response(NO_ACCOUNT, { headers: { "content-type": "text/html; charset=UTF-8" } }),
    // its picture is not a picture, until a test fixes it
    [id64(1004)]: () => xml(profile(id64(1004), AVATAR("broken"))),
    // a profile whose picture Steam's own host no longer has (the host answers 404, as it does for anyone)
    [id64(1005)]: () => xml(profile(id64(1005), AVATAR("gone"), "friendsonly")),
    // a game's other forms of the same ids
    [id64(4011)]: () => xml(profile(id64(4011), AVATAR("gmod"))),
    [id64(5001)]: () => xml(profile(id64(5001), AVATAR("rust"))),
    [id64(6001)]: () => xml(profile(id64(6001), AVATAR("pal"))),
    // Steam saying it is busy
    [id64(7001)]: () => xml("<html>Busy</html>", 503),
    // a profile that never ends and says no length: the service reads no more than it allows
    [id64(1006)]: () => new Response(new ReadableStream({ pull: (stream) => void stream.enqueue(new Uint8Array(16 * 1024).fill(32)) }), { headers: { "content-type": "text/xml" } }),
    // a picture its avatar host fails to serve, which is not the host saying it has none
    [id64(1007)]: () => xml(profile(id64(1007), AVATAR("boom"))),
    // a redirect to a private address
    [id64(1008)]: () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/profiles/x/?xml=1" } }),
};
// the players of a crowded server (`s-crowd`): each has a profile with a picture
const CROWD = 1100;
const CROWD_FIRST = 20_000;
// the 17-digit ids are past what a number holds exactly
const inCrowd = (account: string | undefined) => account !== undefined && BigInt(account) >= BigInt(id64(CROWD_FIRST)) && BigInt(account) < BigInt(id64(CROWD_FIRST + CROWD));
const crowdName = (n: number) => `Player ${String(n).padStart(4, "0")}`;
// Steam Community's stand-in: the profile XML of each account, or Steam being down while a test says so
const steam = loopbackServer((_req, url) => {
    const account = /^\/profiles\/(\d+)\/$/.exec(url.pathname)?.[1];
    if (!account || url.search !== "?xml=1") return new Response("not found", { status: 404 });
    if (steamFails !== null) return xml("<html>Busy</html>", steamFails);
    if (inCrowd(account)) return xml(profile(account, AVATAR("crowd")));
    return (profiles[account] ?? (() => xml(NOT_FOUND)))();
});
// the service reaches both as it reaches the real ones, by fetchPublic
trustLoopback(steam);
STEAM_COMMUNITY.origin = steam.url;
trustLoopback(avatars);
STEAM_AVATAR_HOSTS.push(new URL(avatars.url).host);
/** the accounts the page's players made Steam Community see, each as the request that asked for it */
const asked = () => steam.requests.map((request) => /^\/profiles\/(\d+)\//.exec(request)?.[1]).filter(Boolean);

describe("a Steam account as the service takes it", () => {
    test("every form a game writes an id in is the same 17-digit account, and what is no account is none", () => {
        expect(steamAccount("[U:1:1001]")).toBe(id64(1001));
        // Garry's Mod's: the account is twice the number, plus the low bit
        expect(steamAccount("STEAM_0:1:2005")).toBe(id64(4011));
        expect(steamAccount("STEAM_1:0:2005")).toBe(id64(4010));
        expect(steamAccount(id64(1001))).toBe(id64(1001));
        // accounts past the three billionth have ids that start 7656120, not 7656119
        expect(steamAccount("[U:1:4000000000]")).toBe("76561201960265728");
        expect(requireAccount("76561201960265728")).toBe("76561201960265728");
        expect(steamAccount(`steam_${id64(1001)}`)).toBe(id64(1001));
        for (const other of ["BOT", "Console", "", "[U:1:0]", "[U:2:5]", "[U:1:4294967296]", "STEAM_0:2:1", "STEAM_ID_PENDING", "xbox_123456", "steam_1234", "76561197960265728", "7656119796026572900"]) expect([other, steamAccount(other)]).toEqual([other, null]);
        expect(requireAccount(id64(1001))).toBe(id64(1001));
        for (const bad of ["[U:1:1001]", "BOT", 7, null, "../../x", "76561197960265728"]) expect(() => requireAccount(bad)).toThrow("17-digit Steam id");
    });

    test("a profile's picture is read from its XML; no profile is none and anything unreadable is a failure", () => {
        expect(parseProfile(profile(id64(1), "https://avatars.example/a"), id64(1))).toEqual({ medium: "https://avatars.example/a_medium.jpg", full: "https://avatars.example/a_full.jpg" });
        expect(parseProfile(NOT_FOUND, id64(1))).toBeNull();
        // an account number nobody holds: the same words as XML, or as the HTML error page Steam answers it with
        expect(parseProfile(`<response><error><![CDATA[Failed loading profile data, please try again later.]]></error></response>`, id64(1))).toBeNull();
        expect(parseProfile(NO_ACCOUNT, id64(1))).toBeNull();
        expect(() => parseProfile(`<response><error><![CDATA[Rate limit exceeded]]></error></response>`, id64(1))).toThrow("Steam Community said: Rate limit exceeded");
        expect(() => parseProfile(profile(id64(2), "https://avatars.example/a"), id64(1))).toThrow("isn't the profile of");
        expect(() => parseProfile(`<profile><steamID64>${id64(1)}</steamID64></profile>`, id64(1))).toThrow("has no picture in it");
        expect(() => parseProfile(`<profile><steamID64>${id64(1)}</steamID64><avatarFull><![CDATA[https://avatars.example/a_full.jpg]]></avatarFull></profile>`, id64(1))).toThrow("has no picture in it");
        expect(() => parseProfile("<html>nginx</html>", id64(1))).toThrow("isn't the profile of");
    });
});

let daemon: TestDaemon;
let served: { url: string; stop: () => void };
beforeAll(async () => {
    daemon = await startTestDaemon();
    served = await setUp();
});
afterAll(async () => {
    served?.stop();
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
async function setUp() {
    const server = (id: string, name: string, game: string, settings: Record<string, unknown> = {}) => ({ id, name, game, directory: `${SERVERS}/${id}`, createdAt: 0, settings: { configured: true, ...settings } });
    const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(
        config,
        JSON.stringify({
            version: 2,
            serversDirectory: SERVERS,
            servers: [
                server("s-tf", "Payload", TF2.id),
                server("s-gmod", "Sandbox", GMOD.id),
                server("s-rust", "Wasteland", RUST.id),
                server("s-pal", "Paldea", PALWORLD.id),
                server("s-down", "Offline Steam", TF2.id),
                server("s-crowd", "Crowded", TF2.id),
            ],
        }),
    );
    const files = (id: string, tree: Record<string, string>) => writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id), tree);
    const seen = (steamId: string, name: string) => ({ steamId, name, lastSeen: 1_700_000_000_000 });
    files("s-tf", {
        "players.json": JSON.stringify([seen("[U:1:1001]", "Alice"), seen("[U:1:1002]", "Bob"), seen("[U:1:1003]", "Carol"), seen("[U:1:1004]", "Dave"), seen("[U:1:1005]", "Frank")]),
    });
    files("s-gmod", { "players.json": JSON.stringify([seen("STEAM_0:1:2005", "Gus")]) });
    files("s-rust", { "rust-players.json": JSON.stringify([seen(id64(5001), "Rusty")]) });
    files("s-pal", {
        "palworld-players.json": JSON.stringify([
            { userId: `steam_${id64(6001)}`, name: "Pal", accountName: "Pal", level: 3, lastSeen: 1_700_000_000_000 },
            { userId: "xbox_1234567890", name: "Xena", accountName: "Xena", level: 5, lastSeen: 1_700_000_000_000 },
        ]),
    });
    files("s-crowd", { "players.json": JSON.stringify(Array.from({ length: CROWD }, (_, n) => seen(`[U:1:${CROWD_FIRST + n}]`, crowdName(n)))) });
    files("s-down", { "players.json": JSON.stringify([seen("[U:1:7001]", "Eve")]) });
    const { gameServerService } = await import("../src/service");
    await gameServerService.ready;
    return servePanel(daemon);
}

// what a row's avatar shows: its picture, or the figure's glyph, and what it says to whoever points at it
const avatarOf = (name: string, where: "row" | "open" = "row") => {
    const root = where === "row" ? `document.querySelector('input[name=playersList][value="${name}"]')?.closest("label, li, [role=radio]")` : `document.querySelector('[class*=xlarge]')?.parentElement`;
    return `(() => { const avatar = ${root}?.querySelector('[class*=PaperAvatar]'); return avatar ?  { src: avatar.querySelector("img")?.getAttribute("src") ?? null, glyph: avatar.querySelector("img") ? null : avatar.textContent.trim(), title: avatar.title, label: avatar.getAttribute("aria-label") } : null; })()`;
};
type Avatar = { src: string | null; glyph: string | null; title: string; label: string | null };
const avatar = (page: Page, name: string, where: "row" | "open" = "row") => page.evaluate<Avatar>(avatarOf(name, where));

/** a page of `server`'s Players tab, and every address it asked for that isn't the panel's own or the daemon's */
async function openPlayers(server: string, waitForPlayer: string) {
    const page = await openPage(`${served.url}/?server=${server}`);
    const elsewhere: string[] = [];
    const own = [served.url, `ws://127.0.0.1:${daemon.port}`];
    page.on(({ method, params }) => {
        const url: string | undefined = method === "Network.requestWillBeSent" ? params.request.url : method === "Network.webSocketCreated" ? params.url : undefined;
        if (url && !url.startsWith("data:") && !own.some((origin) => url.startsWith(origin))) elsewhere.push(url);
    });
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="players"]')`, "the server menu");
    await page.click('input[name=serverMenu][value="players"]');
    await page.waitFor(`document.querySelector('input[name=playersList][value="${waitForPlayer}"]')`, "the players");
    return { page, elsewhere };
}

describe("Steam players' pictures in the Players tab", () => {
    test("Team Fortress 2's players show their Steam pictures, in the list and on the opened player, each asked of Steam once, and the page never loads an address", async () => {
        const { page, elsewhere } = await openPlayers("s-tf", "Alice");
        try {
            await page.waitFor(`${avatarOf("Alice")}?.src && ${avatarOf("Bob")}?.src`, "Alice's and Bob's pictures");
            // a friends-only profile has its picture too; each is told apart by its own
            expect((await avatar(page, "Alice")).src).toBe(dataUrl(RED));
            expect((await avatar(page, "Bob")).src).toBe(dataUrl(GREEN));
            // an account with no profile is the figure, which says why; it is not the hourglass of a picture still coming
            await page.waitFor(`${avatarOf("Carol")}.title === "Steam has no picture for this account"`, "Carol's note");
            expect(await avatar(page, "Carol")).toMatchObject({ src: null, glyph: "person" });
            // a picture Steam's host no longer has is the same figure, not an alert
            await page.waitFor(`${avatarOf("Frank")}?.title === "Steam has no picture for this account"`, "Frank's note");
            expect(await avatar(page, "Frank")).toMatchObject({ src: null, glyph: "person", label: null });

            await page.click('input[name=playersList][value="Alice"]');
            await page.waitFor(`document.querySelector('[class*=xlarge] img')`, "Alice's picture on her page");
            expect((await avatar(page, "Alice", "open")).src).toBe(dataUrl(RED));
            // the page asked for no address of its own, and Steam saw each account once
            expect(elsewhere).toEqual([]);
            expect([...asked()].sort()).toEqual([id64(1001), id64(1002), id64(1003), id64(1004), id64(1005)]);
            // a list's rows asked for the 64 px picture, and only the opened player for the 184 px one
            expect(avatars.requests.filter((request) => request === "/alice_medium.jpg")).toHaveLength(1);
            expect(avatars.requests.filter((request) => request.endsWith("_full.jpg"))).toEqual(["/alice_full.jpg"]);
            expect(page.exceptions).toEqual([]);

            // another page of the same server is no new ask of Steam
            // loaded again and waited for: a bare location.reload() let the next wait
            // match the old page, and a click land while the new one had no body
            await page.navigate(await page.evaluate<string>("location.href"));
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="players"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="players"]');
            await page.waitFor(`${avatarOf("Alice")}?.src`, "Alice's picture again");
            expect([...asked()].sort()).toEqual([id64(1001), id64(1002), id64(1003), id64(1004), id64(1005)]);
        } finally {
            await page.close();
        }
    }, 90_000);

    test("a picture that can't be had is a failure on the player, said above the list, and Try again asks again", async () => {
        const { page, elsewhere } = await openPlayers("s-tf", "Dave");
        try {
            await page.waitFor(`${avatarOf("Dave")}?.label`, "Dave's failure");
            const dave = await avatar(page, "Dave");
            expect(dave).toMatchObject({ src: null, glyph: "error" });
            expect(dave.label).toContain("Dave's picture couldn't be loaded");
            expect(dave.label).toContain("Steam sent text/html where a picture should be");
            // the notice above the list; the other players keep their pictures and the list works
            const notice = await page.evaluate<string>(`document.querySelector('[class*=PaperQuote]')?.innerText ?? ""`);
            expect(notice).toContain("Profile pictures unavailable");
            expect(notice).toContain("One picture is missing");
            expect((await avatar(page, "Alice")).src).toBe(dataUrl(RED));

            broken = false;
            await page.click(`[class*=PaperQuote] button`);
            await page.waitFor(`${avatarOf("Dave")}?.src`, "Dave's picture after Try again");
            expect((await avatar(page, "Dave")).src).toBe(dataUrl(YELLOW));
            await page.waitFor(`!document.querySelector('[class*=PaperQuote]')`, "the notice gone");
            expect(elsewhere).toEqual([]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
        }
    }, 90_000);

    test("Garry's Mod's STEAM_0 ids, Rust's 17-digit ids and Palworld's steam_ ids are Steam accounts too, and another platform's player is not", async () => {
        for (const [server, name, picture] of [["s-gmod", "Gus", YELLOW], ["s-rust", "Rusty", GREEN], ["s-pal", "Pal", BLUE]] as const) {
            const { page, elsewhere } = await openPlayers(server, name);
            try {
                await page.waitFor(`${avatarOf(name)}?.src`, `${name}'s picture`);
                expect([server, (await avatar(page, name)).src]).toEqual([server, dataUrl(picture)]);
                if (server === "s-pal") {
                    // Xbox players have no Steam account: the figure, with nothing asked of Steam for them
                    expect(await avatar(page, "Xena")).toMatchObject({ src: null, glyph: "person", title: "" });
                }
                expect(elsewhere).toEqual([]);
                expect(page.exceptions).toEqual([]);
            } finally {
                await page.close();
            }
        }
        expect([...asked()]).toEqual(expect.arrayContaining([id64(4011), id64(5001), id64(6001)]));
        expect(asked().filter((account) => !Object.hasOwn(profiles, account!))).toEqual([]);
    }, 120_000);

    test("a profile is read within its cap however it arrives, redirects are checked, and a picture its host fails to serve is a failure, not a missing picture", async () => {
        // an answer that never ends and names no length is cut off at the cap, and says why
        await expect(steamAvatar(id64(1006), "medium")).rejects.toThrow("Steam Community's profile is larger than expected");
        // a redirect to a private address is refused before anything is dialed
        await expect(steamAvatar(id64(1008), "medium")).rejects.toThrow("10.0.0.1 is a private or local address");
        // the avatar host failing (500) is shown; its 404 is its answer that there is no picture
        await expect(steamAvatar(id64(1007), "medium")).rejects.toThrow("answered 500");
        await expect(steamAvatar(id64(1005), "full")).resolves.toBeNull();
        // none of these is Steam Community failing: it is not left alone for them
        await expect(steamAvatar(id64(9101), "medium")).resolves.toBeNull();
        expect(asked()).toContain(id64(9101));
        await expect(steamAvatar(id64(1001), "large")).rejects.toThrow('"medium" or "full"');
    }, 30_000);

    test("a crowd of players asks only for the rows on screen, each once, and a row scrolled to keeps its picture", async () => {
        const { page, elsewhere } = await openPlayers("s-crowd", crowdName(0));
        try {
            const rowOf = (n: number) => avatarOf(crowdName(n));
            await page.waitFor(`${rowOf(0)}?.src`, "the first player's picture");
            // asking has settled once Steam Community hears nothing more for a moment
            const settled = async () => {
                let seen = -1;
                for (const deadline = Date.now() + 20_000; Date.now() < deadline; ) {
                    if (steam.requests.length === seen) return;
                    seen = steam.requests.length;
                    await Bun.sleep(800); // quiet: letting requests pile up to see that none do
                }
                throw new Error("Steam Community kept being asked for pictures");
            };
            await settled();
            const crowd = () => asked().filter(inCrowd);
            const first = crowd();
            // only the rows on screen were asked for, and none twice
            expect(new Set(first).size).toBe(first.length);
            expect(first.length).toBeGreaterThan(0);
            expect(first.length).toBeLessThan(CROWD / 4);
            // the rows scrolled to are asked for as they come to be on screen, and what is shown stays
            const scrollTo = (n: number) => page.evaluate(`document.querySelector('input[name=playersList][value="${crowdName(n)}"]').closest("label, li, [role=radio]").scrollIntoView()`);
            await scrollTo(CROWD - 1);
            await page.waitFor(`${rowOf(CROWD - 1)}?.src`, "the last player's picture");
            await settled();
            const all = crowd();
            expect(new Set(all).size).toBe(all.length);
            expect(all.length).toBeGreaterThan(first.length);
            expect(all.length).toBeLessThan(CROWD / 2);
            await scrollTo(0);
            await page.waitFor(`${rowOf(0)}?.src`, "the first player's picture, still there");
            await settled();
            // coming back asks for nothing again; at most a row the first view never reached
            const again = crowd();
            expect(new Set(again).size).toBe(again.length);
            expect(again.slice(0, all.length)).toEqual(all);
            expect(again.length - all.length).toBeLessThan(10);
            expect(elsewhere).toEqual([]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
        }
    }, 120_000);

    test("while Steam Community is down every picture fails out loud, and the service rests from it instead of asking again for each", async () => {
        steamFails = 503;
        const { page } = await openPlayers("s-down", "Eve");
        try {
            await page.waitFor(`${avatarOf("Eve")}?.label`, "Eve's failure");
            const eve = await avatar(page, "Eve");
            expect(eve).toMatchObject({ src: null, glyph: "error" });
            expect(eve.label).toContain("Steam Community answered HTTP 503");
            expect(await page.evaluate<string>(`document.querySelector('[class*=PaperQuote]')?.innerText ?? ""`)).toContain("Steam Community answered HTTP 503");
            // the list still works: the player opens
            await page.click('input[name=playersList][value="Eve"]');
            await page.waitFor(`document.querySelector('[class*=xlarge]')`, "Eve's page");
            // resting: the next account is refused without asking Steam
            const before = steam.requests.length;
            await expect(steamAvatar(id64(1001), "full")).resolves.toBe(dataUrl(RED));
            await expect(steamAvatar(id64(9001), "medium")).rejects.toThrow("Steam Community answered HTTP 503");
            expect(steam.requests).toHaveLength(before);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
        }
    }, 90_000);

    test("Steam Community limiting us, or not answering at all, also puts the service to rest, told from its status and not its words", async () => {
        const rested = () => setSystemTime(new Date(Date.now() + 2 * 60 * 1000));
        try {
            // the rest from the 503 above has passed
            rested();
            steamFails = 429;
            await expect(steamAvatar(id64(9201), "medium")).rejects.toThrow("Steam Community is limiting how often profile pictures are asked for");
            const before = steam.requests.length;
            await expect(steamAvatar(id64(9202), "medium")).rejects.toThrow("limiting how often");
            expect(steam.requests).toHaveLength(before);
            // a 403 is no reason to rest: it is shown as it is, and the next account is asked
            rested();
            steamFails = 403;
            await expect(steamAvatar(id64(9203), "medium")).rejects.toThrow("Steam Community answered HTTP 403 for a profile");
            steamFails = null;
            await expect(steamAvatar(id64(9204), "medium")).resolves.toBeNull();
            // a Steam that can't be reached
            const gone = loopbackServer(() => new Response("never"));
            trustLoopback(gone);
            gone.stop();
            const origin = STEAM_COMMUNITY.origin;
            STEAM_COMMUNITY.origin = gone.url;
            try {
                await expect(steamAvatar(id64(9205), "medium")).rejects.toThrow("Couldn't load profile pictures from Steam Community: Couldn't reach");
                STEAM_COMMUNITY.origin = origin;
                // resting: even a Steam that answers is left alone
                await expect(steamAvatar(id64(9206), "medium")).rejects.toThrow("Couldn't load profile pictures from Steam Community");
            } finally {
                STEAM_COMMUNITY.origin = origin;
            }
        } finally {
            setSystemTime();
        }
    }, 30_000);
});
