// A bot's on switch, on its card and its Overview, in a real browser: it
// flips once the bot is on or off, with the knob's thump, and a save that
// fails leaves it as saved and says why.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { testDaemon } from "./helpers/daemon";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
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

const toggle = (name: string, within = "document") => `${within}.querySelector('[role=switch][aria-label="${name} is on"]')`;

/**
 * Presses the switch and resolves with whether it thumped: the switch
 * reports each class it takes on from the press on, so a thump that is
 * already over is still seen.
 */
async function press(page: Page, selector: string, checked: boolean): Promise<boolean> {
    await page.evaluate(`(() => {
        const el = ${selector};
        window.thumped = false;
        new MutationObserver(() => { if (/animating/.test(el.className)) window.thumped = true; }).observe(el, { attributes: true, attributeFilter: ["class"] });
        el.dataset.test = "switch";
    })()`);
    await page.click(`[data-test="switch"]`);
    await page.waitFor(`${selector}.getAttribute("aria-checked") === "${checked}"`, `the switch to turn ${checked ? "on" : "off"}`);
    return page.evaluate<boolean>(`window.thumped`);
}

describe("a bot's on switch", () => {
    test("on the Overview and the bot's card it flips with a thump once the bot is off, and back on", async () => {
        const fake = discord.addBot({ username: "Switchy", guilds: [guild("Home")] });
        await savedBots([{ stored: storedBot("b-switch", fake.appId, { name: "Switchy" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Switchy to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`${toggle("Switchy")} !== null`, "the bot's card");
            expect(await press(page, toggle("Switchy"), false)).toBe(true);
            await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.enabled === false && !s.bots[0]?.connected, "Switchy to be off");

            await page.evaluate(`[...document.querySelectorAll("[class*=card], [class*=Card]")].filter((el) => el.innerText?.includes("Switchy")).at(-1).dataset.test = "card"`);
            await page.click(`[data-test="card"]`);
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview");
            const overview = toggle("Switchy", `document.querySelector("[class*=PaperInterfaceGroup], [class*=InterfaceGroup]")`);
            await page.waitFor(`${overview} !== null`, "the Overview's switch");
            expect(await press(page, overview, true)).toBe(true);
            await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.enabled && s.bots[0]?.connected), "Switchy to be on");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a switch whose save fails stays as saved and says why", async () => {
        const fake = discord.addBot({ username: "Stubborn", guilds: [guild("Home")] });
        await savedBots([{ stored: storedBot("b-stubborn", fake.appId, { name: "Stubborn" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Stubborn to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const configs = path.join((await testDaemon()).dataDir, "configs");
        try {
            await page.waitFor(`document.body.innerText.includes("Stubborn")`, "the bot list");
            await page.evaluate(`[...document.querySelectorAll("[class*=card], [class*=Card]")].filter((el) => el.innerText?.includes("Stubborn")).at(-1).dataset.test = "card"`);
            await page.click(`[data-test="card"]`);
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview");
            const overview = toggle("Stubborn", `document.querySelector("[class*=InterfaceGroup]")`);
            fs.chmodSync(configs, 0o555);
            try {
                await page.evaluate(`${overview}.dataset.test = "switch"`);
                await page.click(`[data-test="switch"]`);
                await page.waitFor(`document.body.innerText.includes("Couldn't turn the bot on or off")`, "the failed save");
            } finally {
                fs.chmodSync(configs, 0o755);
            }
            expect(await page.evaluate<string>(`document.body.innerText`)).toMatch(/Could not save the bots: .*(EACCES|permission denied)/i);
            // the next announcement still has the bot on, as it is saved
            await call("markSetupGuideSeen");
            await page.waitFor(`document.body.innerText.includes("Gateway status")`, "the Overview after the next announcement");
            expect(await page.evaluate<string | null>(`${overview}.getAttribute("aria-checked")`)).toBe("true");
            expect(await page.evaluate<string>(`document.body.innerText`)).toContain("Gateway status\tConnected");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
