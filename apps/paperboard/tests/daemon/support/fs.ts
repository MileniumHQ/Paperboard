// Throwaway directories for the daemon suite. Every directory lives under
// os.tmpdir() and is removed once every test file has run, so a run never
// leaves anything behind and never reaches the developer's ~/.paperboard.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const created: string[] = [];

// Runs after every test file (tests/setup.ts); bun test fires no exit handlers.
export function registerTestCleanup(cleanup: () => void | Promise<void>): void {
	const cleanups = (globalThis as { __paperboardTestCleanup?: Array<() => void | Promise<void>> }).__paperboardTestCleanup;
	if (!cleanups) throw new Error("tests/setup.ts is not preloaded: run the suite with bun test from apps/paperboard");
	cleanups.push(cleanup);
}

registerTestCleanup(() => {
	for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// A fresh, empty temp directory. Its real path is returned, so paths the
// daemon resolves through realpath compare equal on macOS (/var -> /private/var).
export function tempDir(prefix = "pb-daemon-"): string {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	created.push(dir);
	return dir;
}

// A data directory laid out like a real PAPERBOARD_DIR.
export function dataDir(): string {
	const dir = tempDir("pb-data-");
	for (const sub of ["packages", "panels", "configs", "files", "local", "logs", "sockets"]) {
		fs.mkdirSync(path.join(dir, sub), { recursive: true });
	}
	return dir;
}

export function removeDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

// Every file under dir, relative and with forward slashes, sorted.
export function listTree(dir: string): string[] {
	const out: string[] = [];
	const walk = (rel: string) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			out.push(child);
			if (entry.isDirectory()) walk(child);
		}
	};
	if (fs.existsSync(dir)) walk("");
	return out.sort();
}

// The permission bits of a file (POSIX only; callers branch on platform).
export function modeOf(file: string): number {
	return fs.statSync(file).mode & 0o777;
}
