// Waiting on real signals. waitFor re-checks a condition (a file appearing,
// a process exiting, a frame arriving) until it holds, and fails with the
// caller's description once a generous deadline passes. Nothing here waits a
// fixed time and then assumes something happened.
// Each test file raises bun's 5 s per-test ceiling itself, with
// setDefaultTimeout(TEST_TIMEOUT_MS) at its top: the setting holds only in the
// file whose evaluation called it, so a shared module or preload can't do it.
// Daemon tests start real processes; each wait below carries its own deadline
// and message, so the ceiling only backs those up.
export const TEST_TIMEOUT_MS = 60_000;

export interface WaitOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

export async function waitFor<T>(
	what: string,
	check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
	{ timeoutMs = 15_000, intervalMs = 20 }: WaitOptions = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	for (;;) {
		try {
			const value = await check();
			if (value) return value as T;
			lastError = undefined;
		} catch (err) {
			lastError = err;
		}
		if (Date.now() > deadline) {
			const why = lastError ? ` (last error: ${(lastError as Error)?.message ?? lastError})` : "";
			throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${why}`);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

// Rejects with a clear message when a promise does not settle in time.
export async function within<T>(what: string, promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// Whether a pid is a live process (a signal-0 probe).
export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		throw err;
	}
}
