import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
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

/** the `href` of the "Open" link in the card titled `title`, once it has one */
const openLink = (title: string) => `(() => {
    const card = [...document.querySelectorAll("[class*=PaperCard]")].filter((c) => c.innerText.includes(${JSON.stringify(title)})).pop();
    return [...(card?.querySelectorAll("a") ?? [])].find((a) => a.innerText.includes("Open"))?.getAttribute("href") ?? "";
})()`;

async function openInvite(page: Page, bot: string): Promise<void> {
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(bot)})`, "the bot list");
    const tag = `t${Math.random().toString(36).slice(2)}`;
    await page.evaluate(`(() => {
        const all = [...document.querySelectorAll("[class*=card], [class*=Card]")].filter((el) => el.innerText?.includes(${JSON.stringify(bot)}));
        all.filter((el) => !all.some((other) => other !== el && el.contains(other)))[0].dataset.test = ${JSON.stringify(tag)};
    })()`);
    await page.click(`[data-test="${tag}"]`);
    await page.waitFor(`!!document.querySelector("input[name=botMenu][value=invite]")`, "the bot's tabs");
    await page.click(`input[name=botMenu][value="invite"]`);
}

describe("the invite page", () => {
    test("each link is named for what it does, copied or opened, and its address is not shown", async () => {
        const fake = discord.addBot({ username: "Inviter", guilds: [] });
        await savedBots([{ stored: storedBot("b-inv", fake.appId, { name: "Inviter" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Inviter to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await openInvite(page, "Inviter");
            await page.waitFor(`${openLink("Add to a server")}.includes("client_id=${fake.appId}")`, "the server link");
            await page.waitFor(`${openLink("Install on your account")}.includes("integration_type=1")`, "the install link");
            const text = await page.evaluate<string>("document.body.innerText");
            expect(text).toContain("Add to a server");
            expect(text).toContain("Install on your account");
            // no raw address on the page
            expect(text).not.toContain("discord.com/api/oauth2");
            // each card has its own copy and open actions, the permissions sit in the first
            const cards = await page.evaluate<{ title: string; copy: number; open: number; boxes: number }[]>(`["Add to a server", "Install on your account"].map((title) => {
                const card = [...document.querySelectorAll("[class*=PaperCard]")].filter((c) => c.innerText.includes(title)).pop();
                return { title, copy: [...card.querySelectorAll("button")].filter((b) => b.innerText.includes("Copy link")).length, open: [...card.querySelectorAll("a")].filter((a) => a.innerText.includes("Open") && a.target === "_blank").length, boxes: card.querySelectorAll("input[type=checkbox]").length };
            })`);
            expect(cards.map((c) => [c.title, c.copy, c.open])).toEqual([["Add to a server", 1, 1], ["Install on your account", 1, 1]]);
            expect(cards[0]!.boxes).toBeGreaterThan(0);
            expect(cards[1]!.boxes).toBe(0);

            // the permissions feed the server link
            const before = await page.evaluate<string>(openLink("Add to a server"));
            await page.evaluate(`[...document.querySelectorAll("label")].find((l) => l.innerText.includes("Administrator")).click()`);
            await page.waitFor(`${openLink("Add to a server")} !== ${JSON.stringify(before)} && ${openLink("Add to a server")} !== ""`, "the link to follow the pick");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
