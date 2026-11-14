// A bot's page as a person uses it: added through New bot, it opens on its
// Overview with the avatar the service fetched (the page itself loads
// nothing from Discord), and the messages shown there stay right when a
// read answers late.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { guild, startFakeDiscord, userMessage, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const browser = panelBrowser();

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

/** Clicks, as a mouse would, the innermost `selector` element whose text includes `text`. */
async function clickText(page: Page, selector: string, text: string): Promise<void> {
    const tag = `t${Math.random().toString(36).slice(2)}`;
    const found = await page.evaluate<boolean>(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.innerText?.includes(${JSON.stringify(text)}));
        const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
        if (!inner[0]) return false;
        inner[0].dataset.test = ${JSON.stringify(tag)};
        return true;
    })()`);
    if (!found) throw new Error(`Nothing matching ${selector} shows "${text}"`);
    await page.click(`[data-test="${tag}"]`);
}

const loopback = (url: string) => /^(https?|wss?):\/\/127\.0\.0\.1(:\d+)?\//.test(url) || /^(data|blob):/.test(url);

describe("a bot's page", () => {
    test("New bot opens the added bot, whose avatar the service fetched: the page asks nothing of Discord", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        await call("markSetupGuideSeen");
        const fake = discord.addBot({ username: "Newcomer" });
        const served = await servePanel();
        const page = await browser.open("about:blank");
        const loaded: string[] = [];
        const stop = page.on(({ method, params }) => {
            if (method === "Network.requestWillBeSent") loaded.push(String(params.request?.url ?? ""));
        });
        try {
            await page.send("Network.enable");
            await page.navigate(served.url);
            await page.waitFor(`document.body.innerText.includes("No bots yet")`, "the empty bot list");
            await clickText(page, "button", "New bot");
            await page.type(`input[type=password]`, fake.token);
            await clickText(page, "button", "Add bot");
            await page.waitFor(`document.body.innerText.includes("Newcomer") && document.body.innerText.includes("Gateway status")`, "the new bot's Overview");
            await page.waitFor(`[...document.images].some((img) => img.src.startsWith("data:image/png") && img.complete && img.naturalWidth > 0)`, "the avatar the service handed over");
            expect(discord.pictures.some((p) => p.startsWith("/cdn/embed/avatars/"))).toBe(true);
            expect(loaded.filter((url) => !loopback(url))).toEqual([]);
            const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 1, "the added bot");
            expect(state.bots[0]).toMatchObject({ name: "Newcomer", applicationId: fake.appId, connected: true });
            expect(page.exceptions).toEqual([]);
        } finally {
            stop();
            await page.close();
            served.stop();
        }
    });

    test("a message heard while the Overview's first read is on its way stays when the read lands", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Listener", guilds: [home] });
        await savedBots([{ stored: storedBot("b-listen", fake.appId, { name: "Listener" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Listener to connect");
        const served = await servePanel();
        const page = await browser.open("about:blank");
        try {
            // the page's answer to getBotInfo (the only one that carries recentMessages) waits until the test lets it through
            await page.send("Page.addScriptToEvaluateOnNewDocument", {
                source: `(() => {
                    const held = (window.__held = []);
                    const add = WebSocket.prototype.addEventListener;
                    WebSocket.prototype.addEventListener = function (type, listener, options) {
                        if (type !== "message") return add.call(this, type, listener, options);
                        return add.call(this, type, (event) => {
                            if (typeof event.data === "string" && event.data.includes('"recentMessages"') && !window.__let) held.push(() => listener(event));
                            else listener(event);
                        }, options);
                    };
                    window.__release = () => { window.__let = true; for (const deliver of held.splice(0)) deliver(); };
                })()`,
            });
            await page.navigate(served.url);
            await page.waitFor(`document.body.innerText.includes("Listener")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Listener");
            await page.waitFor(`window.__held.length > 0`, "the Overview's first read");

            discord.dispatch(fake, "MESSAGE_CREATE", userMessage(home, "heard live"));
            await page.waitFor(`document.body.innerText.includes("heard live")`, "the live message");
            await page.evaluate(`window.__release()`);
            expect(await page.evaluate<boolean>(`document.body.innerText.includes("heard live")`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
