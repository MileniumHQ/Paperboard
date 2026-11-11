import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { getSupervisorSocketPath, supervisorEndpointName, supervisorPresent } from "../../../papercrane/supervisor";
import { supervisorLaunch } from "../../../papercrane/supervisorLaunch";
import { PaperCraneAuth } from "../../../papercrane/auth";
import { PanelServicesManager } from "../../../papercrane/panelServices";
import { killWorkloads, startCrane, workloadRecords, type CraneProcess } from "../../daemon/support/crane";
import { dataDir, tempDir } from "../../daemon/support/fs";
import { installPanelFiles, serviceSource } from "../../daemon/support/panels";
import { Rpc } from "../../daemon/support/rpc";
import { isAlive, TEST_TIMEOUT_MS, waitFor } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const dirs: string[] = [];
const cranes: CraneProcess[] = [];
afterAll(async () => {
	for (const crane of cranes) await crane.stop();
	for (const dir of dirs) await killWorkloads(dir);
});

async function crane(dir = dataDir(), options: { headless?: boolean } = {}): Promise<CraneProcess> {
	if (!dirs.includes(dir)) dirs.push(dir);
	const started = await startCrane({ dataDir: dir, ...options });
	cranes.push(started);
	return started;
}

async function stopped(c: CraneProcess) {
	cranes.splice(cranes.indexOf(c), 1);
	return c.stop();
}

const js = (code: string) => ({ command: process.execPath, args: ["-e", code] });
const forever = js("process.stdin.resume(); setInterval(() => {}, 1000)");
const dataOf = (rpc: Rpc, id: string, stream?: string) =>
	rpc.frames
		.filter((f) => f.type === "event" && f.event === "process:data" && f.payload.id === id && (!stream || f.payload.stream === stream))
		.map((f) => f.payload.data)
		.join("");
const exitOf = (rpc: Rpc, id: string) =>
	rpc.next((f) => f.type === "event" && f.event === "process:exit" && f.payload.id === id, 20_000, `${id}'s exit`).then((f) => f.payload.exitCode);

// Stopping the daemon or crashing the app never stops supervised workloads.
describe("stopping the daemon never stops its workloads", () => {
	test("after the daemon stops the workload keeps running, and the next daemon adopts it and can kill it", async () => {
		for (const headless of [true, false]) {
			const dir = dataDir();
			const first = await crane(dir, { headless });
			const rpc = await first.rpc();
			await rpc.ok("process:run", { id: "survivor", ...forever });
			const [record] = await waitFor("the workload's metadata", () => workloadRecords(dir).length === 1 && workloadRecords(dir));
			await rpc.close();
			const exit = await stopped(first);
			if (process.platform !== "win32") expect(exit.code).toBe(0);
			expect(isAlive(record!.childPid)).toBe(true);

			const next = await crane(dir);
			const adopter = await next.rpc();
			expect((await adopter.ok("process:exists", { id: "survivor" })).running).toBe(true);
			await adopter.ok("process:attach", { id: "survivor" });
			await adopter.ok("process:kill", { id: "survivor" });
			await waitFor("the adopted workload to exit", () => !isAlive(record!.childPid));
			await adopter.close();
		}
	});

	test("restarting a panel service keeps its workloads running", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.keeper", service: serviceSource() });
		const c = await crane(dir);
		const rpc = await c.rpc();
		const token = (await rpc.ok("auth:panel-token", { panelId: "test.keeper" })).token;
		const owner = await Rpc.authed(c.url, token);
		await owner.ok("process:run", { id: "kept", ...forever });
		await waitFor("the service to be ready", async () => (await rpc.call("panel:restartService", { panelId: "test.keeper" })).result?.restarted === true);
		expect((await rpc.ok("panel:restartService", { panelId: "test.keeper" })).restarted).toBe(true);
		expect((await owner.ok("process:exists", { id: "kept" })).running).toBe(true);
		await owner.ok("process:kill", { id: "kept" });
		await owner.close();
		await rpc.close();
	});

	test("every host starts the supervisor from its own copy in the data directory, and a copy that was changed is replaced", async () => {
		expect(supervisorLaunch("w1", "/data/local/bin/paperboard-supervisor-0123456789abcdef", "/data", { A: "1" })).toEqual({
			command: "/data/local/bin/paperboard-supervisor-0123456789abcdef",
			args: ["--data-dir", "/data", "--supervise", "w1"],
			env: { A: "1" },
		});

		const dir = dataDir();
		const bin = path.join(dir, "local", "bin");
		const copies = () => (fs.existsSync(bin) ? fs.readdirSync(bin).filter((name) => /^paperboard-supervisor-[0-9a-f]{16}(\.exe)?$/.test(name)) : []);
		const first = await crane(dir);
		const rpc = await first.rpc();
		// nothing is copied until a workload needs it
		expect(copies()).toEqual([]);
		await rpc.ok("process:run", { id: "copied", ...forever });
		expect(copies()).toHaveLength(1);
		const copy = path.join(bin, copies()[0]!);
		const shipped = fs.readFileSync(copy);
		if (process.platform !== "win32") expect(fs.statSync(copy).mode & 0o111).not.toBe(0);
		await rpc.ok("process:kill", { id: "copied" });
		await exitOf(rpc, "copied");
		await rpc.close();
		await stopped(first);

		// a copy someone changed is not what this build ships: it is replaced
		// before anything runs from it, and an older build's copy is cleared
		// (swapped in by rename: a program that is still exiting cannot be written to)
		fs.writeFileSync(`${copy}.swap`, "not the supervisor");
		await waitFor("the first workload's supervisor to let go of its file", () => {
			try { fs.renameSync(`${copy}.swap`, copy); return true; }
			catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err; return false; }
		});
		const older = path.join(bin, `paperboard-supervisor-0000000000000000${process.platform === "win32" ? ".exe" : ""}`);
		fs.writeFileSync(older, "an older build's supervisor");
		const next = await crane(dir);
		const again = await next.rpc();
		await again.ok("process:run", { id: "restored", ...js("console.log('ran')") });
		expect(await exitOf(again, "restored")).toBe(0);
		expect(dataOf(again, "restored")).toContain("ran");
		expect(fs.readFileSync(copy).equals(shipped)).toBe(true);
		expect(fs.existsSync(older)).toBe(false);
		await again.close();
	});
});

// Supervised workloads are adopted, reported and stopped faithfully.
describe("supervised workloads are reported faithfully", () => {
	test("output printed between a socket's connect and its attach arrives once, in the replay", async () => {
		const dir = dataDir();
		const c = await crane(dir);
		const rpc = await c.rpc();
		await rpc.ok("process:run", { id: "gap", ...js("process.stdin.on('data', (d) => process.stdout.write('got:' + d)); setInterval(() => {}, 1000)") });
		await rpc.ok("process:write", { id: "gap", data: "one\n" });
		await waitFor("the first answer", () => dataOf(rpc, "gap").includes("got:one"));

		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dir;
		let socketPath: string;
		try {
			socketPath = getSupervisorSocketPath("gap");
		} finally {
			process.env.PAPERBOARD_DIR = previous;
		}
		const frames: Array<{ type: string; data?: string }> = [];
		let buffered = "";
		const socket = net.connect(socketPath);
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffered += chunk;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) if (line.trim()) frames.push(JSON.parse(line));
		});
		await waitFor("the supervisor's status frame", () => frames.some((f) => f.type === "status"));

		await rpc.ok("process:write", { id: "gap", data: "two\n" });
		await waitFor("the second answer", () => dataOf(rpc, "gap").includes("got:two"));
		expect(frames.filter((f) => f.type === "data")).toEqual([]);

		socket.write(JSON.stringify({ type: "attach" }) + "\n");
		await waitFor("the replay", () => frames.some((f) => f.type === "history"));
		await rpc.ok("process:write", { id: "gap", data: "three\n" });
		await waitFor("the live answer", () => frames.some((f) => f.type === "data" && f.data?.includes("got:three")));
		const seen = frames.filter((f) => f.type === "history" || f.type === "data").map((f) => f.data).join("");
		expect(seen).toBe("got:one\ngot:two\ngot:three\n");

		socket.destroy();
		await rpc.ok("process:kill", { id: "gap" });
		await rpc.close();
	});

	test("each attached socket gets every chunk once, split multibyte characters arrive whole, and terminals report one exit each", async () => {
		const c = await crane();
		const creator = await c.rpc();
		const other = await c.rpc();
		await creator.ok("process:run", {
			id: "fanout",
			...js(`process.stdout.write(Buffer.from([0xc3])); process.stderr.write("half\\n"); let buffered = ""; process.stdin.on("data", (d) => { buffered += d; let at; while ((at = buffered.indexOf("\\n")) !== -1) { const line = buffered.slice(0, at); buffered = buffered.slice(at + 1); if (line === "rest") process.stdout.write(Buffer.from([0xa9, 0x0a])); else process.stdout.write("line:" + line + "\\n"); } });`),
		});
		await creator.ok("process:attach", { id: "fanout" });
		await other.ok("process:attach", { id: "fanout" });
		await creator.next((f) => f.event === "process:data" && f.payload.stream === "stderr" && f.payload.data.includes("half"));
		await creator.ok("process:write", { id: "fanout", data: "rest\n" });
		await creator.ok("process:write", { id: "fanout", data: "one\n" });
		for (const rpc of [creator, other]) {
			await waitFor("the line on every socket", () => dataOf(rpc, "fanout", "stdout").includes("line:one"));
		}
		expect(dataOf(creator, "fanout", "stdout")).toBe("é\nline:one\n");
		expect(dataOf(other, "fanout", "stdout").endsWith("é\nline:one\n")).toBe(true);
		expect(dataOf(other, "fanout", "stdout").split("line:one").length).toBe(2);
		await creator.ok("process:kill", { id: "fanout" });

		if (process.platform !== "win32") {
			await creator.ok("term:create", { id: "term-exit" });
			await other.ok("term:attach", { id: "term-exit" });
			await creator.ok("term:write", { id: "term-exit", data: "exit 3\r" });
			for (const rpc of [creator, other]) {
				await rpc.next((f) => f.event === "term:exit" && f.payload.id === "term-exit");
			}
			await creator.ok("events:subscribe", { events: [] });
			await other.ok("events:subscribe", { events: [] });
			for (const rpc of [creator, other]) {
				expect(rpc.frames.filter((f) => f.event === "term:exit" && f.payload.id === "term-exit")).toHaveLength(1);
			}
		}
		await creator.close();
		await other.close();
	});

	test("a fast workload's output and exit wait for an attach, and exit codes are reported exactly", async () => {
		const c = await crane();
		const rpc = await c.rpc();
		await rpc.ok("process:run", { id: "fast", ...js("console.log('quick'); process.exit(7)") });
		expect(await exitOf(rpc, "fast")).toBe(7);
		expect(dataOf(rpc, "fast")).toBe("quick\n");

		if (process.platform === "win32") {
			await rpc.ok("process:run", { id: "crash", command: "cmd.exe", args: ["/c", "exit", "-1073741819"] });
			expect(await exitOf(rpc, "crash")).toBe(0xc0000005);
		} else {
			await rpc.ok("process:run", { id: "killed", ...js("process.kill(process.pid, 'SIGKILL')") });
			expect(await exitOf(rpc, "killed")).toBe(137);
		}
		await rpc.close();
	});

	// a wrapper's grandchild holds the output pipes: with only the wrapper
	// ended, the workload never closes and its stop is refused
	test("killing a workload ends its whole tree, and the workload exits", async () => {
		const c = await crane();
		const rpc = await c.rpc();
		await rpc.ok("process:run", { id: "tree", ...js(`const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }); console.log("child:" + c.pid); setInterval(() => {}, 1000);`) });
		const grandchild = Number((await waitFor("the grandchild's pid", () => /child:(\d+)/.exec(dataOf(rpc, "tree"))))[1]);
		await Promise.all([exitOf(rpc, "tree"), rpc.ok("process:kill", { id: "tree" })]);
		await waitFor("the grandchild to be ended with its parent", () => !isAlive(grandchild));
		await rpc.close();
	});

	test("ids get distinct fixed-length endpoints, a restarted daemon adopts under the same id and refuses a second start", async () => {
		expect(supervisorEndpointName("a.b")).not.toBe(supervisorEndpointName("a_b"));
		expect(supervisorEndpointName("x").length).toBe(supervisorEndpointName("y".repeat(128)).length);

		const dir = dataDir();
		const first = await crane(dir);
		const rpc = await first.rpc();
		await rpc.ok("process:run", { id: "a.b", ...js("process.stdin.on('data', (d) => process.stdout.write('dot:' + d)); setInterval(() => {}, 1000)") });
		await rpc.ok("process:run", { id: "a_b", ...js("process.stdin.on('data', (d) => process.stdout.write('under:' + d)); setInterval(() => {}, 1000)") });
		await rpc.close();
		await stopped(first);

		const second = await crane(dir);
		const adopter = await second.rpc();
		expect((await adopter.fail("process:run", { id: "a.b", ...forever })).error).toContain("already running");
		await adopter.ok("process:attach", { id: "a.b" });
		await adopter.ok("process:write", { id: "a.b", data: "hi\n" });
		await waitFor("the adopted workload's answer", () => dataOf(adopter, "a.b").includes("dot:hi"));
		expect(dataOf(adopter, "a_b")).toBe("");

		// an exit is announced after the endpoint is gone, and a replacement's endpoint survives the old one's teardown
		await adopter.ok("process:kill", { id: "a.b" });
		await exitOf(adopter, "a.b");
		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dir;
		try {
			expect(supervisorPresent("a.b")).toBe(false);
			await adopter.ok("process:run", { id: "a.b", ...js("process.stdin.on('data', (d) => process.stdout.write('again:' + d)); setInterval(() => {}, 1000)") });
			await adopter.ok("process:write", { id: "a.b", data: "x\n" });
			await waitFor("the replacement's answer", () => dataOf(adopter, "a.b").includes("again:x"));
			expect(supervisorPresent("a.b")).toBe(true);
		} finally {
			process.env.PAPERBOARD_DIR = previous;
		}
		await adopter.ok("process:kill", { id: "a.b" });
		await adopter.ok("process:kill", { id: "a_b" });
		await adopter.close();
	});
});

// Workloads and terminals start and take input on every platform.
describe("workloads and terminals take input on every platform", () => {
	test("utf16le input, closed input, and PWD set to the workload's own folder", async () => {
		const c = await crane();
		const rpc = await c.rpc();
		await rpc.ok("process:run", { id: "utf16", inputEncoding: "utf16le", ...js("process.stdin.on('data', (d) => process.stdout.write(d.toString('hex')))") });
		await rpc.ok("process:write", { id: "utf16", data: "é\n" });
		await waitFor("the hex of the input", () => dataOf(rpc, "utf16").includes("e9000a00"));
		await rpc.ok("process:kill", { id: "utf16" });

		await rpc.ok("process:run", { id: "noinput", stdin: false, ...js("process.stdin.on('end', () => console.log('eof')); process.stdin.resume()") });
		expect(await exitOf(rpc, "noinput")).toBe(0);
		expect(dataOf(rpc, "noinput")).toContain("eof");
		expect((await rpc.fail("process:write", { id: "noinput", data: "x" })).error).toBeTruthy();

		const cwd = tempDir();
		await rpc.ok("process:run", { id: "pwd", cwd, ...js("console.log(process.env.PWD)") });
		await exitOf(rpc, "pwd");
		expect(dataOf(rpc, "pwd").trim()).toBe(cwd);
		await rpc.close();
	});

	if (process.platform === "win32") {
		test("JAVA_HOME/bin joins the existing Path key without dropping the system path", async () => {
			const c = await crane();
			const rpc = await c.rpc();
			const javaHome = tempDir();
			await rpc.ok("process:run", { id: "javapath", env: { JAVA_HOME: javaHome }, ...js("console.log(JSON.stringify(Object.keys(process.env).filter((k) => k.toUpperCase() === 'PATH').map((k) => [k, process.env[k]])))") });
			await exitOf(rpc, "javapath");
			const keys = JSON.parse(dataOf(rpc, "javapath").trim()) as Array<[string, string]>;
			expect(keys).toHaveLength(1);
			expect(keys[0]![1].startsWith(`${javaHome}/bin;`)).toBe(true);
			expect(keys[0]![1].toLowerCase()).toContain("system32");
			await rpc.close();
		});

		test("a terminal runs its shell behind a pseudoconsole, and takes input and a resize", async () => {
			const c = await crane();
			const rpc = await c.rpc();
			await rpc.ok("term:create", { id: "conpty" });
			const output = () => rpc.frames.filter((f) => f.event === "term:data" && f.payload.id === "conpty").map((f) => f.payload.data).join("");
			await rpc.ok("term:write", { id: "conpty", data: "Write-Output ('PTY-' + (6*7))\r" });
			await waitFor("the terminal's answer", () => output().includes("PTY-42"));
			await rpc.ok("term:resize", { id: "conpty", cols: 132, rows: 43 });
			await rpc.ok("term:write", { id: "conpty", data: "Write-Output ('WIDE-' + $Host.UI.RawUI.WindowSize.Width)\r" });
			await waitFor("the resized terminal's width", () => output().includes("WIDE-132"));
			await rpc.ok("term:destroy", { id: "conpty" });
			await rpc.close();
		});
	} else {
		test("the terminal is a real tty", async () => {
			const c = await crane();
			const rpc = await c.rpc();
			await rpc.ok("term:create", { id: "tty" });
			await rpc.ok("term:write", { id: "tty", data: "expr 40 + 2; test -t 0 && echo IS_A_TTY\r" });
			// the shell's marks (OSC 133, OSC 7) are invisible: what is read is what shows
			const output = () => rpc.frames.filter((f) => f.event === "term:data" && f.payload.id === "tty").map((f) => f.payload.data).join("").replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "");
			await waitFor("the terminal's answer", () => /(^|[\r\n])42\r\n/.test(output()) && output().includes("IS_A_TTY\r"));
			await rpc.ok("term:destroy", { id: "tty" });
			await rpc.close();
		});
	}
});

// A panel follows a terminal from these: the program in front of it, each
// command its shell ran with how it ended, and the folder it is in. Every
// platform's default shell (bash, zsh, PowerShell) is started marked.
describe("a terminal says what it runs", () => {
	test("the program in front, each command with its exit code, and the shell's folder", async () => {
		// a home of its own: the developer's startup files are not the test's
		const home = tempDir("pb-home-");
		fs.writeFileSync(path.join(home, ".bashrc"), "PS1='$ '\n");
		fs.writeFileSync(path.join(home, ".zshrc"), "PS1='$ '\n");
		const c = await crane(dataDir(), { env: { HOME: home, USERPROFILE: home, ZDOTDIR: undefined } });
		const rpc = await c.rpc();
		const target = path.join(tempDir(), "marked folder");
		fs.mkdirSync(target);
		const events = (event: string) => rpc.frames.filter((f) => f.type === "event" && f.event === event && f.payload.id === "marks").map((f) => f.payload);
		await rpc.ok("term:create", { id: "marks", cwd: home });
		await waitFor("the shell's name", () => events("term:foreground").length > 0);
		const shell = String(events("term:foreground")[0].name).toLowerCase();

		await rpc.ok("term:write", { id: "marks", data: `cd "${target}"\r` });
		await waitFor("the new folder", () => events("term:cwd").some((e) => path.basename(e.cwd) === "marked folder"));

		const failing = process.platform === "win32" ? "cmd /c exit 3" : "sh -c 'exit 3'";
		await rpc.ok("term:write", { id: "marks", data: `${failing}\r` });
		const finished = await waitFor("the failed command", () => events("term:command").find((e) => e.command === failing));
		expect(finished.exitCode).toBe(3);
		expect(events("term:command").find((e) => e.command.startsWith("cd "))?.exitCode).toBe(0);

		const [running, program] = process.platform === "win32" ? ["ping -n 4 127.0.0.1 > $null", "ping"] : ["sleep 3", "sleep"];
		await rpc.ok("term:write", { id: "marks", data: `${running}\r` });
		await waitFor("the running program's name", () => events("term:foreground").some((e) => String(e.name).toLowerCase() === program));
		await waitFor("the shell's name again", () => String(events("term:foreground").at(-1).name).toLowerCase() === shell);

		// a socket that attaches later hears what is known already
		const late = await c.rpc();
		await late.ok("term:attach", { id: "marks" });
		await late.next((f) => f.event === "term:cwd" && f.payload.id === "marks" && path.basename(f.payload.cwd) === "marked folder");
		await late.next((f) => f.event === "term:foreground" && f.payload.id === "marks" && String(f.payload.name).toLowerCase() === shell);
		await late.close();

		await rpc.ok("term:destroy", { id: "marks" });
		await rpc.close();
	});
});

// Panel services start and hydrate.
describe("panel services start and hydrate", () => {
	test("a compiled crane on a network address runs services, and __getState waits for onInit or rejects with its error", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.hydrate",
			service: serviceSource({
				extra: "let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });",
				actions: "{ open: async () => { release(); return true; } }",
				options: "state: { phase: 'initial' }, onInit: async (ctx) => { await gate; ctx.setState({ phase: 'ready' }); },",
			}),
		});
		await installPanelFiles(dir, {
			id: "test.broken",
			service: serviceSource({ options: "onInit: async () => { throw new Error('init exploded'); }," }),
		});
		const started = await startCrane({ dataDir: dir, host: "0.0.0.0" });
		cranes.push(started);
		dirs.push(dir);
		const rpc = await started.rpc();
		await waitFor("the hydrate service to register", async () => (await rpc.ok("actions:list", { panelId: "test.hydrate" })).actions.length >= 2);
		const state = rpc.call("actions:call", { panelId: "test.hydrate", action: "__getState", args: [] });
		await rpc.ok("actions:call", { panelId: "test.hydrate", action: "open", args: [] });
		expect((await state).result).toEqual({ result: { phase: "ready" } });

		await waitFor("the broken service to register", async () => (await rpc.ok("actions:list", { panelId: "test.broken" })).actions.length >= 1);
		expect((await rpc.fail("actions:call", { panelId: "test.broken", action: "__getState", args: [] })).error).toContain("init exploded");
		await rpc.close();
	});

	test("stopService resolves only once the service process has exited", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.stopper", service: serviceSource({ extra: "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300));" }) });
		const auth = new PaperCraneAuth(false, path.join(dir, "local"));
		const services = new PanelServicesManager(dir);
		services.setAuth(auth);
		expect(services.startService("test.stopper")).toBe(true);
		const [root] = services.processRoots();
		expect(root?.panelId).toBe("test.stopper");
		await services.stopService("test.stopper");
		expect(isAlive(root!.pid)).toBe(false);
		expect(services.runningCount()).toBe(0);
		auth.dispose();
	});

	test("back-to-back setState calls are coalesced into one sync in flight", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.chatty",
			service: serviceSource({ actions: "{ burst: async (ctx) => { for (let i = 1; i <= 200; i++) ctx.setState({ n: i }); return true; } }", options: "state: { n: 0 }," }),
		});
		const c = await crane(dir);
		const rpc = await c.rpc();
		await waitFor("the chatty service to register", async () => (await rpc.ok("actions:list", { panelId: "test.chatty" })).actions.length >= 2);
		await rpc.ok("events:subscribe", { events: ["*"] });
		await rpc.ok("actions:call", { panelId: "test.chatty", action: "burst", args: [] });
		const syncs = () => rpc.frames.filter((f) => f.type === "event" && String(f.event).startsWith("actions:test.chatty:"));
		await waitFor("the final state to sync", () => syncs().some((f) => f.payload?.state?.n === 200));
		expect(syncs().length).toBeLessThanOrEqual(2);
		await rpc.close();
	});
});
