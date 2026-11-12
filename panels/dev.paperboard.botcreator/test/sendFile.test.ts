import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blocksApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { fileFromUrl } from "../src/discordOps";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "botcreator-files-"));
// a web server with one file on it
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
const web = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (new URL(req.url).pathname === "/cat.png" ? new Response(PICTURE, { headers: { "content-type": "image/png" } }) : new Response("Not found", { status: 404 })) });
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => {
    discord.stop();
    web.stop(true);
    fs.rmSync(work, { recursive: true, force: true });
});
afterEach(stopServices);

const BOT = "b-files";
const run = <T = any>(command: string, inputs: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs, { project: BOT });

// Files are sent from web addresses only.
describe("files are sent from web addresses only", () => {
    test("only an http or https address is a file to send", () => {
        expect(fileFromUrl("https://example.com/a.png")).toEqual({ attachment: "https://example.com/a.png" });
        expect(fileFromUrl(" http://example.com/a.png ", " cat.png ")).toEqual({ attachment: "http://example.com/a.png", name: "cat.png" });
        expect(() => fileFromUrl("/home/me/.ssh/id_ed25519")).toThrow('"/home/me/.ssh/id_ed25519" isn\'t a web address');
        expect(() => fileFromUrl("C:\\Users\\me\\secret.txt")).toThrow("A file is sent from an http or https address");
        expect(() => fileFromUrl("file:///etc/passwd")).toThrow("A file is sent from an http or https address");
        expect(() => fileFromUrl("data:text/plain,hi")).toThrow("A file is sent from an http or https address");
        expect(() => fileFromUrl(undefined)).toThrow('"" isn\'t a web address');
    });

    test("Send File refuses a file on this computer, and nothing reaches Discord", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Uploader", guilds: [home] });
        await savedBots([{ stored: storedBot(BOT, fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
        const secret = path.join(work, "id_ed25519");
        fs.writeFileSync(secret, "-----BEGIN OPENSSH PRIVATE KEY-----");
        const channel = home.channels[0].id;
        const messages = () => discord.requests.filter((r) => r.method === "POST" && r.path === `/channels/${channel}/messages`);

        await expect(run("send-file", { channel, url: secret })).rejects.toThrow("expected a web address");
        await expect(run("send-file", { channel, url: `file://${secret}` })).rejects.toThrow("A file is sent from an http or https address");
        expect(messages()).toEqual([]);

        // a web address is fetched and uploaded as the file
        const sentMessage = await run<{ id: string; channel: string }>("send-file", { channel, url: `http://127.0.0.1:${web.port}/cat.png`, name: "cat.png", content: "a cat" });
        expect(sentMessage).toEqual({ id: expect.stringMatching(/^\d+$/), channel });
        const [sent] = messages();
        expect(sent.body).toMatchObject({ content: "a cat", attachments: [{ id: "0" }] });
        expect(sent.files).toEqual([{ name: "cat.png", bytes: PICTURE }]);
    });
});
