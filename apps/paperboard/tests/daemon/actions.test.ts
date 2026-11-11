import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { TEST_TIMEOUT_MS } from "./support/wait";
import { startDaemon, type InProcessDaemon } from "./support/inproc";
import { Rpc } from "./support/rpc";

setDefaultTimeout(TEST_TIMEOUT_MS);

let daemon: InProcessDaemon;
const sockets: Rpc[] = [];

beforeAll(async () => {
	daemon = await startDaemon();
});
afterAll(async () => {
	for (const socket of sockets) await socket.close();
	await daemon.stop();
});

async function host(): Promise<Rpc> {
	const rpc = await daemon.rpc();
	sockets.push(rpc);
	return rpc;
}
async function panel(id: string): Promise<Rpc> {
	const rpc = await daemon.panelRpc(id);
	sockets.push(rpc);
	return rpc;
}

// Answers every action_call frame this socket receives with `reply(frame)`.
function serveCalls(rpc: Rpc, reply: (frame: any) => unknown): void {
	rpc.ws.on("message", (data) => {
		const frame = JSON.parse(String(data));
		if (frame?.type === "action_call") rpc.send({ type: "action_reply", callId: frame.callId, result: reply(frame) });
	});
}

// Action identity is bound to the token claim.
describe("action identity comes from the token claim", () => {
	test("a panel cannot register, emit or trigger under another panel's id, and nothing is broadcast", async () => {
		const watcher = await host();
		await watcher.ok("events:subscribe", { events: ["*"] });
		const intruder = await panel("test.intruder");

		for (const [action, params] of [
			["actions:register", { panelId: "test.victim", action: "steal" }],
			["actions:emit", { panelId: "test.victim", event: "forged", payload: 1 }],
			["triggers:emit", { panelId: "test.victim", trigger: "forged", output: 1 }],
		] as const) {
			const refusal = await intruder.fail(action, params);
			expect(refusal.code).toBe("FORBIDDEN");
		}
		const listed = await watcher.ok("actions:list", { panelId: "test.victim" });
		expect(listed.actions).toEqual([]);

		// the panel's own emit is broadcast, and it is the only event that is
		await intruder.ok("actions:emit", { panelId: "test.intruder", event: "own", payload: 2 });
		await watcher.next((f) => f.type === "event" && f.event === "actions:test.intruder:own");
		const forged = watcher.frames.filter((f) => f.type === "event" && String(f.event).includes("test.victim"));
		expect(forged).toEqual([]);
	});

	test("only the socket a call went to can answer it", async () => {
		const owner = await panel("test.answerer");
		await owner.ok("actions:register", { panelId: "test.answerer", action: "ask" });
		const forger = await panel("test.forger");
		const caller = await host();

		const answer = caller.call("actions:call", { panelId: "test.answerer", action: "ask", args: [] });
		const call = await owner.next((f) => f.type === "action_call" && f.action === "ask");
		// a different authenticated socket replies first with a forged result
		forger.send({ type: "action_reply", callId: call.callId, result: "forged" });
		await forger.ok("events:subscribe", { events: [] });
		owner.send({ type: "action_reply", callId: call.callId, result: "genuine" });
		expect((await answer).result).toEqual({ result: "genuine" });
	});

	test("an internal action answers only its own panel and the host", async () => {
		const owner = await panel("test.internal");
		await owner.ok("actions:register", { panelId: "test.internal", action: "__state", schema: { internal: true } });
		serveCalls(owner, (frame) => ({ caller: frame.caller.panelId }));

		const other = await panel("test.outsider");
		const refused = await other.fail("actions:call", { panelId: "test.internal", action: "__state" });
		expect(refused.code).toBe("FORBIDDEN");

		const self = await panel("test.internal");
		expect((await self.ok("actions:call", { panelId: "test.internal", action: "__state" })).result).toEqual({ caller: "test.internal" });
		const hostSocket = await host();
		expect((await hostSocket.ok("actions:call", { panelId: "test.internal", action: "__state" })).result).toEqual({ caller: null });
	});
});

// Action names and projects are owned by the registering socket.
describe("action names and projects belong to the socket that registered them", () => {
	test("another socket gets CONFLICT for a held name, and a conflicting batch registers nothing", async () => {
		const first = await host();
		const second = await host();
		await first.ok("actions:register", { panelId: "test.owned", action: "held" });
		expect((await second.fail("actions:register", { panelId: "test.owned", action: "held" })).code).toBe("CONFLICT");
		expect((await second.fail("actions:unregister", { panelId: "test.owned", action: "held" })).code).toBe("CONFLICT");
		expect((await second.fail("actions:register", { panelId: "test.owned", actions: ["fresh", "held"] })).code).toBe("CONFLICT");
		const names = (await second.ok("actions:list", { panelId: "test.owned" })).actions.map((a: any) => a.action);
		expect(names).toEqual(["held"]);

		// the name frees up once its owner closes
		await first.close();
		await second.ok("actions:register", { panelId: "test.owned", action: "held" });
	});

	test("projects group actions, and removing the project or closing its socket removes them", async () => {
		const owner = await host();
		await owner.ok("actions:project-define", { panelId: "test.proj", project: "bot1", name: "Bot 1" });
		await owner.ok("actions:register", { panelId: "test.proj", action: "bot1/send" });
		await owner.ok("actions:register", { panelId: "test.proj", action: "bot1/ban" });
		const listed = (await owner.ok("actions:list", { panelId: "test.proj" })).actions;
		expect(listed.map((a: any) => [a.action, a.project]).sort()).toEqual([["bot1/ban", "bot1"], ["bot1/send", "bot1"]]);

		// another socket can't register into it, nor into an undefined project
		const other = await host();
		expect((await other.call("actions:register", { panelId: "test.proj", action: "bot1/extra" })).error).toBeTruthy();
		expect((await owner.call("actions:register", { panelId: "test.proj", action: "nope/extra" })).error).toBeTruthy();
		expect((await other.fail("actions:project-remove", { panelId: "test.proj", project: "bot1" })).code).toBe("CONFLICT");

		await owner.ok("actions:project-remove", { panelId: "test.proj", project: "bot1" });
		expect((await owner.ok("actions:list", { panelId: "test.proj" })).actions).toEqual([]);

		await owner.ok("actions:project-define", { panelId: "test.proj", project: "bot2", name: "Bot 2" });
		await owner.ok("actions:register", { panelId: "test.proj", action: "bot2/send" });
		await owner.close();
		expect((await other.ok("actions:projects", { panelId: "test.proj" })).projects).toEqual([]);
		expect((await other.ok("actions:list", { panelId: "test.proj" })).actions).toEqual([]);
	});

	test("a Blocks project's picture is a file in the panel's folder or a data:image URL, and nothing else", async () => {
		const owner = await panel("test.pics");
		const png = "data:image/png;base64,iVBORw0KGgo=";
		await owner.ok("blocks:project-define", { panelId: "test.pics", project: "s1", name: "Server 1", icon: "dns", image: png });
		await owner.ok("blocks:project-define", { panelId: "test.pics", project: "s2", name: "Server 2", image: "/assets/games/minecraft/icon.webp" });
		for (const image of ["https://example.com/a.png", "../other/icon.png", "/assets/../../x.png", "data:text/html;base64,PGI+", "javascript:alert(1)", `data:image/png;base64,${"A".repeat(512 * 1024)}`]) {
			expect((await owner.fail("blocks:project-define", { panelId: "test.pics", project: "s3", name: "Server 3", image })).code).toBe("INVALID_PARAMS");
		}
		const projects = (await owner.ok("blocks:projects", { panelId: "test.pics" })).projects;
		expect(projects.map((p: any) => [p.id, p.icon, p.image])).toEqual([
			["s1", "dns", png],
			["s2", undefined, "/assets/games/minecraft/icon.webp"],
		]);
	});

	test("a socket gets only the events it declared, a new declaration replaces the old, [] unsubscribes and * takes all", async () => {
		const emitter = await panel("test.events");
		const listener = await host();
		const emit = (event: string) => emitter.ok("actions:emit", { panelId: "test.events", event, payload: event });
		const seen = () => listener.frames.filter((f) => f.type === "event").map((f) => f.payload);

		// a marker the listener always sees: a direct call answer
		const sync = () => listener.ok("actions:list", { panelId: "none.here" });

		await emit("a");
		await sync();
		expect(seen()).toEqual([]);

		await listener.ok("events:subscribe", { events: ["actions:test.events:a"] });
		await emit("b");
		await emit("a");
		await listener.next((f) => f.type === "event" && f.payload === "a");
		expect(seen()).toEqual(["a"]);

		await listener.ok("events:subscribe", { events: ["actions:test.events:b"] });
		await emit("a");
		await emit("b");
		await listener.next((f) => f.type === "event" && f.payload === "b");
		expect(seen()).toEqual(["a", "b"]);

		await listener.ok("events:subscribe", { events: [] });
		await emit("b");
		await listener.ok("events:subscribe", { events: ["*"] });
		await emit("c");
		await listener.next((f) => f.type === "event" && f.payload === "c");
		expect(seen()).toEqual(["a", "b", "c"]);
	});
});
