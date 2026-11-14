// Kept apart from crane.ts so scripts outside the daemon suite (the platform
// launcher, scripts/releaseSmoke.ts) can use it without importing ./fs, which
// needs the suite's tests/setup.ts preload.

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
