import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, TOASTS, type Page } from "./helpers/browser";
import { guild, snowflake, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
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

// The server explorer asks the service for the bot it is showing.
describe("the server explorer", () => {
    test("Send a message sends as the bot whose server is open", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Keeper", guilds: [home] });
        await savedBots([{ stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-keep")?.connected), "Keeper to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Keeper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("Home")`, "the server list");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("Send a message")`, "the server's page");
            await clickText(page, "button", "Send");
            const sent = await discord.request((r) => r.method === "POST" && r.path === `/channels/${home.channels[0]!.id}/messages`, "the message to reach Discord");
            expect(sent.bot).toBe(fake.token);
            expect(sent.body.content).toBe("Hello from Paperboard!");
            await page.waitFor(`document.body.innerText.includes("Posted to #general")`, "the confirmation");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("Send with nothing written says so under the message field, and typing takes it away", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Quiet", guilds: [home] });
        await savedBots([{ stored: storedBot("b-quiet", fake.appId, { name: "Quiet" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-quiet")?.connected), "Quiet to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const MESSAGE = `document.querySelector('input[placeholder="Message"]')`;
        const said = `document.getElementById(${MESSAGE}.getAttribute("aria-describedby") ?? "")?.innerText ?? ""`;
        try {
            await page.waitFor(`document.body.innerText.includes("Quiet")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Quiet");
            await page.click(`input[name=botMenu][value="servers"]`);
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`${MESSAGE} !== null`, "the message field");
            await page.evaluate(`${MESSAGE}.select()`);
            await page.send("Input.insertText", { text: " " });
            await clickText(page, "button", "Send");
            await page.waitFor(`${said}.includes("Write a message first.")`, "the field to say what is missing");
            expect(await page.evaluate<string | null>(`${MESSAGE}.getAttribute("aria-invalid")`)).toBe("true");
            await page.send("Input.insertText", { text: "hi" });
            await page.waitFor(`${said} === ""`, "the words to go as it is typed");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

// What a server holds reads as rows, the same as every list in Paperboard,
// and the rows fit a phone.
describe("a server's page", () => {
    test("its channels, roles and members are list rows that fit a phone", async () => {
        const home = { ...guild("Home"), channels: [{ id: snowflake(), name: "a-channel-with-a-name-long-enough-to-run-past-a-phone-screen" }] };
        const fake = discord.addBot({ username: "Lister", guilds: [home] });
        await savedBots([{ stored: storedBot("b-list", fake.appId, { name: "Lister" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Lister to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Lister")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Lister");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("Home")`, "the server list");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("@everyone")`, "the server's page");
            await clickText(page, "button", "Search");
            await page.waitFor(`document.body.innerText.includes("@Lister")`, "the member search");

            /** the list row (a PaperList item) that shows `text`, or null */
            const row = (text: string) => `([...document.querySelectorAll("[class*=PaperList] [data-value]")].find((el) => el.innerText.includes(${JSON.stringify(text)})) ?? null)`;
            const rows = await page.evaluate<Record<string, boolean>>(`({
                channel: ${row("a-channel-with-a-name")} !== null,
                role: ${row("@everyone")} !== null,
                member: ${row("@Lister")} !== null,
            })`);
            expect(rows).toEqual({ channel: true, role: true, member: true });
            // the same page on a phone
            await page.resize(390, 800);
            await page.evaluate(`new Promise((resolve) => { const tick = () => (document.getAnimations().length ? requestAnimationFrame(tick) : resolve(true)); tick(); })`);
            const spilled = await page.evaluate<string[]>(`[...document.querySelectorAll("[class*=PaperCard]")].filter((el) => el.getClientRects().length > 0 && el.scrollWidth > el.clientWidth).map((el) => el.innerText.slice(0, 40))`);
            expect(spilled).toEqual([]);
            expect(await page.evaluate<number>(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

// A message is confirmed only on the page of the server it went to: an
// answer that comes back after the person opened another server is dropped.
describe("a test message's answer", () => {
    test("a send that answers after another server was opened shows nothing on that server's page", async () => {
        const home = guild("Home");
        const away = { ...guild("Away"), channels: [{ id: snowflake(), name: "lobby" }] };
        const fake = discord.addBot({ username: "Keeper", guilds: [home, away] });
        await savedBots([{ stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.find((b) => b.id === "b-keep")?.guilds.length === 2, "Keeper to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.resize(1400, 900);
            await page.waitFor(`document.body.innerText.includes("Keeper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("2 servers")`, "the server list");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("Send a message")`, "Home's page");

            const homeMessages = `/channels/${home.channels[0]!.id}/messages`;
            const release = discord.hold((r) => r.method === "POST" && r.path === homeMessages);
            await clickText(page, "button", "Send");
            await discord.request((r) => r.method === "POST" && r.path === homeMessages, "Home's message to reach Discord");

            // the way back is quiet, so Refresh is the one filled action in the header
            expect(await page.evaluate<boolean>(`(() => {
                const fill = (text) => getComputedStyle([...document.querySelectorAll("button")].find((b) => b.innerText.includes(text))).backgroundColor;
                return fill("All servers") === "rgba(0, 0, 0, 0)" && fill("Refresh") !== "rgba(0, 0, 0, 0)";
            })()`)).toBe(true);
            await clickText(page, "button", "All servers");
            await page.waitFor(`document.body.innerText.includes("2 servers")`, "the server list again");
            await clickText(page, "[class*=card], [class*=Card]", "Away");
            await page.waitFor(`document.body.innerText.includes("#lobby")`, "Away's page");
            // Away's own Send is ready: Home's message isn't sending here
            await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.innerText.includes("Send") && !b.innerText.includes("Sending") && !b.disabled)`, "Away's Send button");

            release();
            // the bot's next message to Home queues behind the held one, so once it is
            // answered Home's answer has left the service; a Refresh answered after that
            // reaches the page behind it
            await call.sendMessage({ bot: "b-keep", channel: home.channels[0]!.id, content: "after" });
            await clickText(page, "button", "Refresh");
            await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.innerText.includes("Refresh") && !b.disabled)`, "the refresh");
            const text = await page.evaluate<string>(`document.body.innerText`);
            expect(text).toContain("#lobby");
            expect(text).not.toContain("Message sent");
            expect(await page.evaluate<string>(`${TOASTS}.join(" ")`)).not.toContain("Couldn't send the message");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

// The server list is the bot's, as the service announces it: it follows the
// bot coming online and a server being renamed without a Refresh.
describe("the server list follows the bot", () => {
    test("a bot turned on while its Servers tab is open shows its servers, and a rename shows in place", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Sleeper", guilds: [home] });
        await savedBots([{ stored: storedBot("b-sleep", fake.appId, { name: "Sleeper", enabled: false }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Sleeper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Sleeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("Bot offline")`, "the offline bot's servers");

            await call.connectBot({ bot: "b-sleep" });
            await page.waitFor(`document.body.innerText.includes("1 member") && !document.body.innerText.includes("Bot offline")`, "the bot's servers once it is on");
            const card = `([...document.querySelectorAll("[class*=card], [class*=Card]")].filter((el) => /Home|Hearth/.test(el.innerText ?? "")).at(-1) ?? null)`;
            await page.evaluate(`window.homeCard = ${card}`);

            discord.dispatch(fake, "GUILD_UPDATE", { id: home.id, name: "Hearth", icon: null, owner_id: fake.appId, features: [] });
            await page.waitFor(`document.body.innerText.includes("Hearth")`, "the renamed server");
            expect(await page.evaluate<boolean>(`window.homeCard.isConnected && window.homeCard === ${card}`)).toBe(true);
            expect(await page.evaluate<string>(`document.body.innerText`)).not.toContain("Home");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

// On a phone each level is a page over the one it was opened from, and back
// (the bar's button, the host's back, a swipe) goes up one level at a time:
// a server, the bot's servers, the bot's menu, the bots.
describe("going back on a phone", () => {
    /** the open page's title: the innermost page that isn't closed */
    const top = `(() => { const open = [...document.querySelectorAll("[role=region]")].filter((el) => !el.inert); return open.at(-1)?.getAttribute("aria-label") ?? "the bots"; })()`;
    /**
     * the ways back a person can see and reach: one bar's (a page inside
     * another is named in the outermost page's bar, whose Back goes back from
     * the innermost open page; in Paperboard the shell draws that bar)
     */
    const backs = `(() => {
        return [...document.querySelectorAll("button")].filter((b) => {
            if (b.closest("[inert]") || !/^(Back|arrow_back)/.test(b.getAttribute("aria-label") ?? b.innerText)) return false;
            const r = b.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === b;
        }).length;
    })()`;
    /** waits until `title` is the open page and it has finished sliding into place */
    const at = async (page: Page, title: string) => {
        await page.waitFor(`${top} === ${JSON.stringify(title)}`, `${title} to be the open page`);
        await page.evaluate(`new Promise((resolve) => { const tick = () => (document.getAnimations().length ? requestAnimationFrame(tick) : resolve(true)); tick(); })`);
    };
    const backEvent = `window.dispatchEvent(new Event("paperboard:back", { cancelable: true }))`;
    /** marks the one bar a person sees (its Back and its header) so the test can press or drag it */
    const markBar = (page: Page) =>
        page.evaluate(`(() => {
            for (const el of document.querySelectorAll("[data-test]")) delete el.dataset.test;
            const back = [...document.querySelectorAll("button[aria-label=Back]")].find((b) => !b.closest("[inert]") && b.checkVisibility());
            back.dataset.test = "back";
            back.closest("header").dataset.test = "bar";
        })()`);

    test("a server goes back to the servers, then the bot's menu, then the bots, one way at a time", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Keeper", guilds: [home] });
        await savedBots([{ stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-keep")?.connected), "Keeper to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.resize(400, 800);
            await page.waitFor(`document.body.innerText.includes("Keeper")`, "the bot list");
            const openServer = async () => {
                await page.waitFor(`document.body.innerText.includes("1 member")`, "the server list");
                await clickText(page, "[class*=card], [class*=Card]", "Home");
                await at(page, "Home");
                await page.waitFor(`document.body.innerText.includes("Send a message")`, "the server's page");
                // one way back: the bar's, never a second control in the page
                expect(await page.evaluate<number>(backs)).toBe(1);
                expect(await page.evaluate<string>(`document.body.innerText`)).not.toContain("All servers");
            };

            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await at(page, "Keeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await at(page, "Servers");
            await openServer();

            // the bar's back: the server, then the servers
            await markBar(page);
            await page.click(`[data-test=back]`);
            await at(page, "Servers");
            expect(await page.evaluate<number>(backs)).toBe(1);

            // the host's back (a phone's back button, the browser's) goes the same way
            await openServer();
            await page.evaluate(backEvent);
            await at(page, "Servers");
            await page.evaluate(backEvent);
            await at(page, "Keeper");

            // and so does a swipe on the bar
            await page.click(`input[name=botMenu][value="servers"]`);
            await at(page, "Servers");
            await openServer();
            await markBar(page);
            await page.drag(`[data-test=bar]`, 300);
            await at(page, "Servers");
            await markBar(page);
            await page.drag(`[data-test=bar]`, 300);
            await at(page, "Keeper");
            await page.evaluate(backEvent);
            await at(page, "the bots");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("on a computer the server's page has its own way back to the list", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Keeper", guilds: [home] });
        await savedBots([{ stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-keep")?.connected), "Keeper to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.resize(1400, 900);
            await page.waitFor(`document.body.innerText.includes("Keeper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("1 member")`, "the server list");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("Send a message")`, "the server's page");
            expect(await page.evaluate<number>(`document.querySelectorAll("[role=region]").length`)).toBe(0);
            await clickText(page, "button", "All servers");
            await page.waitFor(`document.body.innerText.includes("1 server") && !document.body.innerText.includes("Send a message")`, "the server list");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
