import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_DIR } from "./support/crane";
import { dataDir } from "./support/fs";
import { type InProcessDaemon, startDaemon } from "./support/inproc";
import { serviceCall } from "./support/panels";
import type { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// Bot Creator's own service, built from its source, running in the real daemon.
const PANEL = "dev.paperboard.botcreator";
const SOURCE = path.join(REPO_DIR, "panels", PANEL);
// a Discord application id, and a token-shaped string naming it (no real credential)
const APP_ID = "111111111111111111";
const tokenFor = (appId: string) => `${Buffer.from(appId).toString("base64").replace(/=+$/, "")}.GhIjKl.${"x".repeat(27)}`;

let daemon: InProcessDaemon;
let host: Rpc;
let botId: string;

async function installBotCreator(dir: string) {
	const panelDir = path.join(dir, "panels", PANEL);
	fs.mkdirSync(path.join(panelDir, "dist"), { recursive: true });
	const manifest = JSON.parse(fs.readFileSync(path.join(SOURCE, "manifest.json"), "utf8"));
	fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ ...manifest, widgets: undefined }));
	fs.writeFileSync(path.join(panelDir, "dist", "index.html"), "<!doctype html><title>Bot Creator</title>");
	const built = await Bun.build({ entrypoints: [path.join(SOURCE, "src", "service.ts")], target: "bun", format: "esm" });
	if (!built.success) throw new Error(`Bot Creator's service did not build:\n${built.logs.map(String).join("\n")}`);
	fs.writeFileSync(path.join(panelDir, "dist", "service.js"), await built.outputs[0]!.text());
}

const config = () => JSON.parse(fs.readFileSync(path.join(daemon.dataDir, "configs", `${PANEL}.json`), "utf8"));
const listed = async () => (await host.ok("blocks:list", { panelId: PANEL })).entries as Array<{ panelId: string; entry: string }>;
// one of the service's own calls, as Bot Creator's page makes it
const call = (name: string, input: Record<string, unknown>) => host.call("blocks:call", serviceCall(PANEL, name, input, 30_000));
// one of a bot's blocks
const run = (entry: string, inputs: Record<string, unknown>) => host.call("blocks:call", { panelId: PANEL, entry, request: { inputs }, timeoutMs: 30_000 });
const vaulted = async (name: string) => (await host.ok("secrets:get", { name, panelId: PANEL })).found as boolean;

beforeAll(async () => {
	const dir = dataDir();
	await installBotCreator(dir);
	fs.mkdirSync(path.join(dir, "configs"), { recursive: true });
	// a Bot Creator config from before several bots: one bot, no token saved
	fs.writeFileSync(
		path.join(dir, "configs", `${PANEL}.json`),
		JSON.stringify({
			configured: true,
			applicationId: APP_ID,
			commands: [{ id: "cmd-ping", name: "ping", description: "Ping", scope: "global", options: [], userInstall: false }],
			theme: "kept",
		}),
	);
	daemon = await startDaemon({ dataDir: dir });
	host = await daemon.rpc();
	await waitFor("Bot Creator to migrate its legacy bot", () => {
		const saved = config();
		return saved.bots?.length === 1;
	}, { timeoutMs: 60_000 });
	botId = config().bots[0].id;
	// the bot's blocks register in order, its commands' events last
	await waitFor("the migrated bot's blocks to register", async () => (await listed()).some((b) => b.entry.startsWith(`${botId}/event.slash-ping-`)), { timeoutMs: 30_000 });
});
afterAll(async () => {
	await host?.close();
	await daemon?.stop();
});

// Bot Creator migrates its legacy bot and guards tokens and files.
describe("Bot Creator through the daemon", () => {
	test("a pre-multi-bot config becomes one bot with the same commands, in its own Blocks project", async () => {
		const saved = config();
		expect(saved.bots[0]).toMatchObject({ id: botId, applicationId: APP_ID });
		expect(saved.bots[0].commands.map((c: { name: string }) => c.name)).toEqual(["ping"]);
		expect(saved.theme).toBe("kept");
		expect(saved.legacyBot).toBeUndefined();
		const entries = (await listed()).map((b) => b.entry);
		expect(entries).toContain(`${botId}/command.send-message`);
		// the migrated command is an event of the bot's project
		expect(entries.filter((entry) => entry.startsWith(`${botId}/event.slash-ping-`))).toHaveLength(1);
		// the bot's blocks live in its project, not beside the panel's own
		expect(entries).not.toContain("command.send-message");
	});

	test("addBot refuses a non-bot token and a duplicate bot before any login, deleting that vault entry", async () => {
		for (const [id, token, message] of [
			["b-aaaaaaaaaaaa", "not a bot token", "isn't a Discord bot token"],
			["b-bbbbbbbbbbbb", tokenFor(APP_ID), "already uses this bot"],
		] as const) {
			await host.ok("secrets:set", { name: `bot-token.${id}`, value: token, panelId: PANEL });
			const answer = await call("addBot", { bot: id });
			expect({ id, error: answer.error ?? null }).toEqual({ id, error: expect.stringContaining(message) });
			expect({ id, vaulted: await vaulted(`bot-token.${id}`) }).toEqual({ id, vaulted: false });
		}
		expect(config().bots).toHaveLength(1);
	});

	test("Send File refuses addresses that are not web URLs", async () => {
		for (const url of ["/etc/passwd", "file:///etc/passwd", "ftp://example.invalid/x"]) {
			const answer = await run(`${botId}/command.send-file`, { channel: "222222222222222222", url });
			expect({ url, refused: /web address|http or https/.test(answer.error ?? "") }).toEqual({ url, refused: true });
		}
	});

	test("deleteBot removes its project, its blocks and its vaulted token", async () => {
		await host.ok("secrets:set", { name: `bot-token.${botId}`, value: tokenFor(APP_ID), panelId: PANEL });
		const answer = await call("deleteBot", { bot: botId });
		expect(answer.error ?? null).toBeNull();
		expect(answer.result).toEqual({ result: { deleted: botId } });
		expect((await listed()).filter((b) => b.entry.startsWith(`${botId}/`))).toEqual([]);
		expect((await host.ok("blocks:projects", { panelId: PANEL })).projects.map((p: { id: string }) => p.id)).not.toContain(botId);
		expect(await vaulted(`bot-token.${botId}`)).toBe(false);
		expect(config().bots).toEqual([]);
	});
});
