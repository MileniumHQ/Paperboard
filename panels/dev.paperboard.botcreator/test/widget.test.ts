// Bot Creator's Home widgets in a real browser, framed the way Home frames
// them: Bot status says what the bot is doing and connects it from the
// tile, a failed read says so with a Retry that reads again, and Command
// activity charts only the hours it has watched.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { secretsApi } from "@mileniumhq/paperapi";
import { tokenName, type BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const browser = panelBrowser();

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const frame = `document.getElementById("widget").contentDocument`;
/** what the widget shows */
const shown = `(${frame}?.body?.innerText ?? "")`;
/** the widget's button labelled `label` (its text or its aria-label), or null */
const button = (label: string) =>
    `([...(${frame}?.querySelectorAll("button") ?? [])].find((b) => b.innerText.trim() === ${JSON.stringify(label)} || b.getAttribute("aria-label") === ${JSON.stringify(label)}) ?? null)`;

/** Presses the widget's button labelled `label`, as a mouse would. */
async function press(page: Page, label: string): Promise<void> {
    await page.waitFor(`${button(label)} !== null && !${button(label)}.disabled`, `the widget's ${label} button`);
    const at = await page.evaluate<{ x: number; y: number }>(`(() => {
        const box = document.getElementById("widget").getBoundingClientRect();
        const r = ${button(label)}.getBoundingClientRect();
        return { x: box.left + r.left + r.width / 2, y: box.top + r.top + r.height / 2 };
    })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
}

/** Resolves once the page next sends a frame naming `call` and has its answer. */
function readAnswered(page: Page, call: string): Promise<void> {
    const sent = new Promise<unknown>((resolve) => {
        const off = page.on(({ method, params }) => {
            const frame = method === "Network.webSocketFrameSent" ? String(params.response?.payloadData ?? "") : "";
            if (!frame.includes(call)) return;
            off();
            resolve(JSON.parse(frame).id);
        });
    });
    return sent.then((id) => page.received((frame) => JSON.parse(frame).id === id, `the answer to ${call}`));
}

const widget = (url: string, id: string, w: number, h: number, bot: string) => `${url}/widget-host.html?id=${id}&w=${w}&h=${h}&bot=${bot}`;

describe("the Bot status widget", () => {
    test("a bot that's off connects from the 2x1 tile, and keeps its button while nothing changes", async () => {
        const fake = discord.addBot({ username: "Tiled", guilds: [guild("Home")] });
        await savedBots([{ stored: storedBot("b-tiled", fake.appId, { name: "Tiled", enabled: false }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(widget(served.url, "bot-status", 2, 1, "b-tiled"));
        try {
            await page.waitFor(`${shown}.includes("Not connected")`, "the bot's tile to say it isn't connected");
            expect(await page.evaluate<string>(shown)).toContain("Tiled");

            await press(page, "Connect bot");
            await page.waitFor(`${shown}.includes("Online")`, "the tile to show the bot online");
            expect(await page.evaluate<string>(shown)).toMatch(/1\s*server/);
            await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.connected === true && s.bots[0].enabled, "the bot on and connected");

            // Home scrolls it away and back: it reads again, and the same status keeps the same button
            await page.evaluate(`window.openButton = ${button("Open Bot Creator")}`);
            const read = readAnswered(page, "call-get-widget-status");
            await page.evaluate(`window.showWidget(false)`);
            await page.evaluate(`window.showWidget(true)`);
            await within("the widget to read its status again", read);
            // and has drawn what it read
            await page.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
            expect(await page.evaluate<boolean>(`window.openButton.isConnected && window.openButton === ${button("Open Bot Creator")}`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a login Discord refuses says so on the 1x1 tile, and Connect tries again", async () => {
        const fake = discord.addBot({ username: "Refused" });
        const unknown = `${Buffer.from(fake.appId).toString("base64url")}.AAAAAA.${"x".repeat(27)}`;
        await savedBots([{ stored: storedBot("b-refused", fake.appId, { name: "Refused", enabled: false }), token: unknown }]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(widget(served.url, "bot-status", 1, 1, "b-refused"));
        try {
            await page.waitFor(`${shown}.includes("Offline")`, "the 1x1 tile to say the bot is offline");
            await press(page, "Connect");
            await page.waitFor(`${shown}.includes("Couldn't connect")`, "the refused login on the tile");

            // the right token, and Connect again
            await secretsApi.set(tokenName("b-refused"), fake.token, PANEL_ID);
            await press(page, "Connect");
            await page.waitFor(`${shown}.includes("server")`, "the tile to show the bot online");
            expect(await page.evaluate<string>(shown)).not.toContain("Couldn't connect");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a Connect that failed stops being the tile's message once the bot has been online", async () => {
        const fake = discord.addBot({ username: "Recovered" });
        const unknown = `${Buffer.from(fake.appId).toString("base64url")}.AAAAAA.${"x".repeat(27)}`;
        await savedBots([{ stored: storedBot("b-recovered", fake.appId, { name: "Recovered", enabled: false }), token: unknown }]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(widget(served.url, "bot-status", 1, 1, "b-recovered"));
        /** Home scrolls the tile away and back, and it reads the service again */
        const reread = async () => {
            const read = readAnswered(page, "call-get-widget-status");
            await page.evaluate(`window.showWidget(false)`);
            await page.evaluate(`window.showWidget(true)`);
            await within("the widget to read its status again", read);
        };
        try {
            await page.waitFor(`${shown}.includes("Offline")`, "the 1x1 tile to say the bot is offline");
            await press(page, "Connect");
            await page.waitFor(`${shown}.includes("Couldn't connect")`, "the refused login on the tile");

            // the bot is put right and turned on in Bot Creator, not from the tile
            await secretsApi.set(tokenName("b-recovered"), fake.token, PANEL_ID);
            await call("connectBot", { bot: "b-recovered" });
            await reread();
            await page.waitFor(`${shown}.includes("server")`, "the tile to show the bot online");

            // and turned off again: it's off, not failing
            await call("disconnectBot", { bot: "b-recovered" });
            await reread();
            await page.waitFor(`${shown}.includes("Offline")`, "the tile to say the bot is offline");
            expect(await page.evaluate<string>(shown)).not.toContain("Couldn't connect");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a status that can't be read says so, and Retry reads it again", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(widget(served.url, "bot-status", 1, 1, "b-late"));
        try {
            await page.waitFor(`${shown}.includes("Couldn't load status")`, "the failed read on the tile");

            // the bot it names is added after all
            const fake = discord.addBot({ username: "Late" });
            await secretsApi.set(tokenName("b-late"), fake.token, PANEL_ID);
            await call("addBot", { bot: "b-late" });
            await press(page, "Retry");
            await page.waitFor(`${shown}.includes("Late")`, "the tile to show the bot after Retry");
            expect(await page.evaluate<string>(shown)).not.toContain("Couldn't load status");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

describe("the Command activity widget", () => {
    test("charts only the hours since the bot started, and a read that fails offers Retry", async () => {
        const fake = discord.addBot({ username: "Counted" });
        await savedBots([{ stored: storedBot("b-counted", fake.appId, { name: "Counted" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(widget(served.url, "command-activity", 2, 2, "b-counted"));
        const gone = await browser.open(widget(served.url, "command-activity", 2, 2, "b-gone"));
        try {
            const chart = `(${frame}?.querySelector("[aria-label^='Slash commands run per hour']")?.getAttribute("aria-label") ?? "")`;
            await page.waitFor(`${chart} !== ""`, "the activity chart");
            // the service started moments ago: the hours before it weren't watched, and aren't called quiet
            expect(await page.evaluate<string>(chart)).toContain("since ");
            expect(await page.evaluate<string>(shown)).toMatch(/Since .*\n?Now/);

            await gone.waitFor(`${shown}.includes("Couldn't load activity")`, "the failed read on the tile");
            expect(await gone.evaluate<boolean>(`${button("Retry")} !== null`)).toBe(true);
            expect(page.exceptions).toEqual([]);
            expect(gone.exceptions).toEqual([]);
        } finally {
            await page.close();
            await gone.close();
            served.stop();
        }
    });
});
