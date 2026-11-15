import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blocksApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "botcreator-files-"));
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
// a web server on this computer, which a file's address must never reach
const insideHits: string[] = [];
const inside = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => {
        insideHits.push(new URL(req.url).pathname);
        return new Response(PICTURE);
    },
});
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => {
    discord.stop();
    inside.stop(true);
    fs.rmSync(work, { recursive: true, force: true });
});
afterEach(stopServices);

const BOT = "b-files";
const run = <T = any>(command: string, inputs: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs, { project: BOT });

// A file's address comes from a flow, and so maybe from anyone in Discord.
// The service fetches it under the public-address rule, no bigger than
// Discord takes; the test's Discord (and its CDN, where these files are) is
// the one address on this computer it may reach.
describe("Send File", () => {
    test("uploads the file at a web address, and refuses this computer, its network and anything too big", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Uploader", guilds: [home] });
        await savedBots([{ stored: storedBot(BOT, fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
        const channel = home.channels[0].id;
        const messages = () => discord.requests.filter((r) => r.method === "POST" && r.path === `/channels/${channel}/messages`);
        const cdn = `${new URL(discord.api).origin}/cdn`;
        discord.cdnAnswers.set("/cdn/files/cat.png", () => new Response(PICTURE, { headers: { "content-type": "image/png" } }));
        discord.cdnAnswers.set("/cdn/files/to-inside", () => Response.redirect(`http://127.0.0.1:${inside.port}/secret`, 302));
        discord.cdnAnswers.set("/cdn/files/huge.bin", () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)));

        const secret = path.join(work, "id_ed25519");
        fs.writeFileSync(secret, "-----BEGIN OPENSSH PRIVATE KEY-----");
        await expect(run("send-file", { channel, url: secret })).rejects.toThrow("expected a web address");
        await expect(run("send-file", { channel, url: `file://${secret}` })).rejects.toThrow("Only http and https addresses are fetched");
        await expect(run("send-file", { channel, url: `http://127.0.0.1:${inside.port}/secret` })).rejects.toThrow(`127.0.0.1:${inside.port} is a private or local address`);
        await expect(run("send-file", { channel, url: "http://192.168.1.1/router.cfg" })).rejects.toThrow("192.168.1.1 is a private or local address");
        await expect(run("send-file", { channel, url: `${cdn}/files/to-inside` })).rejects.toThrow(`127.0.0.1:${inside.port} is a private or local address`);
        await expect(run("send-file", { channel, url: `${cdn}/files/huge.bin` })).rejects.toThrow("is over 10 MB");
        expect(insideHits).toEqual([]);
        expect(messages()).toEqual([]);

        // a web address is fetched and uploaded as the file, named after it unless named
        const sentMessage = await run<{ id: string; channel: string }>("send-file", { channel, url: `${cdn}/files/cat.png`, content: "a cat" });
        expect(sentMessage).toEqual({ id: expect.stringMatching(/^\d+$/), channel });
        await run("send-file", { channel, url: `${cdn}/files/cat.png`, name: " kitten.png " });
        const [sent, named] = messages();
        expect(sent.body).toMatchObject({ content: "a cat", attachments: [{ id: "0" }] });
        expect(sent.files).toEqual([{ name: "cat.png", bytes: PICTURE }]);
        expect(named.files).toEqual([{ name: "kitten.png", bytes: PICTURE }]);
    });
});
