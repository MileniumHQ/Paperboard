// The daemon as it ships: `bun build --compile ./papercrane/main.ts`, run as
// a child process with its own throwaway data directory and a port the OS
// picks. The binary is compiled once per test process and shared.
//
// Supervised workloads a crane starts are detached and outlive it by design.
// killWorkloads() ends the ones a test data directory recorded, so a test
// cleans up exactly the processes it started and nothing else.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildSupervisor } from "../../../../../scripts/supervisor";
import { registerTestCleanup, tempDir } from "./fs";
import { Rpc } from "./rpc";
import { isAlive, waitFor, within } from "./wait";

export const APP_DIR = path.resolve(import.meta.dir, "../../..");
export const REPO_DIR = path.resolve(APP_DIR, "../..");
const EXE = process.platform === "win32" ? ".exe" : "";

let compiled: Promise<string> | null = null;

// The compiled crane binary (built on first use).
export function craneBinary(): Promise<string> {
	if (!compiled) {
		compiled = (async () => {
			const out = path.join(tempDir("pb-crane-bin-"), `papercrane${EXE}`);
			// the server carries its workload supervisor inside itself
			const supervisor = buildSupervisor();
			const build = Bun.spawn(
				[process.execPath, "build", "--compile", "./papercrane/main.ts", supervisor, "--outfile", out],
				{ cwd: APP_DIR, stdout: "pipe", stderr: "pipe" },
			);
			const [code, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
			if (code !== 0 || !fs.existsSync(out)) {
				throw new Error(`Compiling the crane failed (exit ${code}): ${stderr}`);
			}
			return out;
		})();
	}
	return compiled;
}

// An environment for a child daemon: the parent's, minus anything that would
// point it at a real daemon or change how Electron behaves.
export function childEnv(dataDir: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PAPERBOARD_DIR: dataDir };
	for (const name of ["PAPERCRANE_TOKEN", "PAPERCRANE_PANEL_TOKEN", "PAPERCRANE_PORT", "PAPERCRANE_HOST", "PAPERBOARD_PANEL_ID", "ELECTRON_RUN_AS_NODE"]) {
		delete env[name];
	}
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
	return env;
}

export interface CraneHandshake {
	port: number;
	token: string | null;
	startId: string;
	pid: number;
	listen: { host: string; port: number; secure: boolean };
}

export function readHandshake(dataDir: string): CraneHandshake | null {
	const file = path.join(dataDir, "local", "crane.json");
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

export interface CraneProcess {
	proc: ChildProcess;
	dataDir: string;
	port: number;
	// the loopback plaintext port local clients use
	localPort: number;
	token: string;
	handshake: CraneHandshake;
	url: string;
	httpUrl: string;
	output(): string;
	exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	// host-authenticated RPC socket
	rpc(): Promise<Rpc>;
	// SIGTERM (TerminateProcess on Windows) and wait for the exit
	stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface StartCraneOptions {
	dataDir: string;
	args?: string[];
	env?: Record<string, string | undefined>;
	host?: string;
	port?: number;
	// false runs the interactive screen (on a pipe, as a service manager would)
	headless?: boolean;
	// a copy of the compiled crane to run instead (self-update replaces its own executable)
	binary?: string;
}

const running = new Set<ChildProcess>();
// cranes a test left running: only the children this suite spawned
registerTestCleanup(() => {
	for (const proc of running) {
		if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
	}
});

// Spawns a child process and collects its output.
export function spawnChild(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
	const proc = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
	running.add(proc);
	let output = "";
	proc.stdout?.setEncoding("utf8");
	proc.stderr?.setEncoding("utf8");
	proc.stdout?.on("data", (chunk: string) => {
		output += chunk;
	});
	proc.stderr?.on("data", (chunk: string) => {
		output += chunk;
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		proc.once("exit", (code, signal) => {
			running.delete(proc);
			resolve({ code, signal });
		});
	});
	return { proc, exited, output: () => output };
}

// Runs the compiled crane with arguments and waits for it to exit.
export async function runCrane(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000) {
	const bin = await craneBinary();
	const child = spawnChild(bin, args, env);
	const result = await within(`papercrane ${args.join(" ")} to exit`, child.exited, timeoutMs);
	return { ...result, output: child.output() };
}

// Starts a headless compiled crane on loopback and waits for its handshake.
export async function startCrane(options: StartCraneOptions): Promise<CraneProcess> {
	const bin = options.binary ?? (await craneBinary());
	const host = options.host ?? "127.0.0.1";
	const args = [...(options.headless === false ? [] : ["--headless"]), "--host", host, "--port", String(options.port ?? 0), ...(options.args ?? [])];
	const child = spawnChild(bin, args, childEnv(options.dataDir, options.env));
	let exitedEarly = false;
	void child.exited.then(() => {
		exitedEarly = true;
	});
	const handshake = await waitFor(
		"the crane to write crane.json",
		() => {
			if (exitedEarly) throw new Error(`the crane exited before it was ready:\n${child.output()}`);
			const record = readHandshake(options.dataDir);
			return record && record.pid === child.proc.pid ? record : null;
		},
		{ timeoutMs: 30_000 },
	).catch((err) => {
		child.proc.kill("SIGKILL");
		throw new Error(`${(err as Error).message}\n--- crane output ---\n${child.output()}`);
	});
	if (!handshake.token) throw new Error("The crane wrote no host token");
	const token = handshake.token;
	const url = `ws://127.0.0.1:${handshake.port}`;
	return {
		proc: child.proc,
		dataDir: options.dataDir,
		port: handshake.listen.port,
		localPort: handshake.port,
		token,
		handshake,
		url,
		httpUrl: `http://127.0.0.1:${handshake.port}`,
		output: child.output,
		exited: child.exited,
		rpc: () => Rpc.authed(url, token),
		stop: async () => {
			if (child.proc.exitCode === null && child.proc.signalCode === null) child.proc.kill("SIGTERM");
			return within("the crane to exit", child.exited, 20_000);
		},
	};
}

// Supervisor metadata a data directory holds: one record per live workload.
export function workloadRecords(dataDir: string): Array<{ file: string; pid: number; childPid: number }> {
	const dir = path.join(dataDir, "sockets");
	if (!fs.existsSync(dir)) return [];
	const out: Array<{ file: string; pid: number; childPid: number }> = [];
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		const file = path.join(dir, name);
		const meta = JSON.parse(fs.readFileSync(file, "utf8"));
		if (typeof meta?.pid === "number") out.push({ file, pid: meta.pid, childPid: meta.childPid ?? meta.pid });
	}
	return out;
}

// Ends every supervisor (and its workload tree) recorded in this test data
// directory. These are processes this test started; nothing else is touched.
export async function killWorkloads(dataDir: string): Promise<void> {
	const pids = new Set<number>();
	for (const record of workloadRecords(dataDir)) {
		pids.add(record.childPid);
		pids.add(record.pid);
	}
	for (const pid of pids) {
		if (!isAlive(pid)) continue;
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
		} else {
			process.kill(pid, "SIGKILL");
		}
	}
	await waitFor("the test's workloads to exit", () => [...pids].every((pid) => !isAlive(pid)));
}
