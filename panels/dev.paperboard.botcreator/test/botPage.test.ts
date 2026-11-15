// A bot's page as a person uses it: added through New bot, it opens on its
// Overview with the avatar the service fetched (the page itself loads
// nothing from Discord), and the messages shown there stay right when a
// read answers late.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { guild, slashCommand, startFakeDiscord, userMessage, type FakeDiscord } from "./helpers/discord";
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

    test("a bot being added keeps its dialog until the service answers, then opens", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        await call("markSetupGuideSeen");
        const fake = discord.addBot({ username: "Patient" });
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("No bots yet")`, "the empty bot list");
            await clickText(page, "button", "New bot");
            await page.type(`input[type=password]`, fake.token);
            const release = discord.hold((r) => r.path === "/gateway/bot" && r.bot === fake.token);
            await clickText(page, "button", "Add bot");
            await discord.request((r) => r.path === "/gateway/bot" && r.bot === fake.token, "the new bot's login");
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("Connecting…")`, "the dialog to wait");
            // neither Cancel nor Escape leaves an answer with no dialog to land in
            await clickText(page, "[role=dialog] button", "Cancel");
            await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            expect(await page.evaluate<boolean>(`Boolean(document.querySelector("[role=dialog][aria-modal=true]")?.innerText.includes("Connecting…"))`)).toBe(true);
            release();
            await page.waitFor(`document.body.innerText.includes("Patient") && document.body.innerText.includes("Gateway status")`, "the new bot's Overview");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("what went wrong with no button to say it under is in the bot's Overview, and a picture that couldn't be fetched says why", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Troubled", guilds: [home] });
        // every default avatar is missing from the CDN
        for (let n = 0; n < 6; n++) discord.cdnAnswers.set(`/cdn/embed/avatars/${n}.png`, () => new Response("gone", { status: 404 }));
        await savedBots([{ stored: storedBot("b-trouble", fake.appId, { name: "Troubled" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Troubled to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Troubled")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Troubled");
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview");

            // a command Discord still has but the bot doesn't: no flow runs, and the Overview says so
            discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: home, name: "ghost" }));
            await page.waitFor(`document.body.innerText.includes("Recent problems") && document.body.innerText.includes("/ghost")`, "the problem in the Overview");

            await page.waitFor(`[...document.querySelectorAll("[title]")].some((el) => /picture couldn't be shown: .*404/.test(el.title))`, "the avatar to say why it's empty");
            expect(page.exceptions).toEqual([]);
        } finally {
            for (let n = 0; n < 6; n++) discord.cdnAnswers.delete(`/cdn/embed/avatars/${n}.png`);
            await page.close();
            served.stop();
        }
    });

    test("a picture whose fetch failed says so on every surface, and is never shown as broken once it loads", async () => {
        const fake = discord.addBot({ username: "Blinked" });
        // the CDN fails each default avatar once, then has it again
        for (let n = 0; n < 6; n++) {
            const path = `/cdn/embed/avatars/${n}.png`;
            discord.cdnAnswers.set(path, () => {
                discord.cdnAnswers.delete(path);
                return new Response("busy", { status: 503 });
            });
        }
        await savedBots([{ stored: storedBot("b-blink", fake.appId, { name: "Blinked" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Blinked to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            // the bot's card shows a broken picture, not its glyph or a picture
            await page.waitFor(`document.body.innerText.includes("Blinked") && document.body.innerText.includes("broken_image")`, "the card's broken picture");
            await clickText(page, "[class*=card], [class*=Card]", "Blinked");
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview");
            const said = `[...document.querySelectorAll("[title]")].filter((el) => /picture couldn't be shown: .*503/.test(el.title))`;
            await page.waitFor(`${said}.length > 0`, "the Overview's avatar to say why it's empty");
            expect(await page.evaluate<number>(`${said}.filter((el) => el.querySelector("img")).length`)).toBe(0);
            expect(page.exceptions).toEqual([]);
        } finally {
            for (let n = 0; n < 6; n++) discord.cdnAnswers.delete(`/cdn/embed/avatars/${n}.png`);
            await page.close();
            served.stop();
        }
    });

    test("on a phone the Overview fits: the switch, the name and every message stay inside their cards", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "ModerationHelperBot", guilds: [home] });
        await savedBots([{ stored: storedBot("b-phone", fake.appId, { name: "ModerationHelperBot" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.resize(390, 800);
            await page.waitFor(`document.body.innerText.includes("ModerationHelperBot")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "ModerationHelperBot");
            await page.click(`input[name=botMenu][value="overview"]`);
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview");
            discord.dispatch(fake, "MESSAGE_CREATE", userMessage(home, "see https://example.com/a/very/long/path/that/never/breaks/anywhere/at/all/1234567890"));
            await page.waitFor(`document.body.innerText.includes("never/breaks")`, "the message");

            const layout = await page.evaluate<{ page: number; toggle: number[]; card: number[]; name: number[]; spilled: string[] }>(`(() => {
                const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; };
                // the Overview's own switch: the bot list's card, behind the page, has one too
                const toggle = [...document.querySelectorAll("[aria-label='ModerationHelperBot is on']")].find((el) => el.closest("[class*=PaperCard]"));
                const card = toggle.closest("[class*=PaperCard]");
                const name = [...card.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "ModerationHelperBot");
                const cards = [...document.querySelectorAll("[class*=PaperCard]")].filter((el) => el.getClientRects().length > 0);
                return {
                    page: document.documentElement.scrollWidth,
                    toggle: box(toggle.closest("[class*=PaperToggle]")),
                    card: box(card),
                    name: box(name),
                    spilled: cards.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.innerText.slice(0, 40)),
                };
            })()`);
            expect(layout.page).toBeLessThanOrEqual(390);
            expect(layout.toggle[1]).toBeLessThanOrEqual(layout.card[1]);
            expect(layout.name[1]).toBeLessThanOrEqual(layout.toggle[0]);
            expect(layout.spilled).toEqual([]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
