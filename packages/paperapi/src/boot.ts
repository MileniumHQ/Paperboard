// Service boot context: the credential bundle a panel service is GRANTED at
// start, never discovered from ambient state.
//
// Two boot shapes exist, and both land here as one captured context:
// - In-process services (daemon imports the bundled service module): the
//   daemon publishes `globalThis.__PAPERBOARD_SERVICE_BOOT` immediately
//   before the import and deletes it after. This module consumes it at
//   init — inside that window — so the service owns its credentials for
//   its whole lifetime, immune to later boots or env changes.
// - Spawned services (own process): the daemon sets PAPERBOARD_PANEL_ID,
//   PAPERCRANE_PANEL_TOKEN (scoped `pcp_`, preferred) / PAPERCRANE_TOKEN
//   (master, deprecated — daemon warns loudly) and PAPERCRANE_PORT in the
//   child env. The env is fixed for the process lifetime, so capturing it
//   once at init is equivalent to injection.
//
// Each panel bundles its own copy of PaperAPI (paperapi is not external in
// any panel build), so this module-scoped capture is per-service by
// construction: two in-process services cannot see each other's context,
// and no code path reads identity or credentials back out of process.env
// after init. The scoped token is preferred everywhere; the master token
// is accepted only as the deprecated fallback the daemon already warns
// about, dying at the registry-opening gate.

export interface ServiceBootContext {
    panelId: string;
    token: string;
    port: number;
}

const BOOT_GLOBAL = "__PAPERBOARD_SERVICE_BOOT";

let cached: ServiceBootContext | null = null;
let captured = false;

function fromGlobal(): ServiceBootContext | null {
    if (typeof globalThis === "undefined") return null;
    const raw = (globalThis as any)[BOOT_GLOBAL];
    if (raw === undefined) return null;
    // consume-once: the context belongs to the module that captured it
    delete (globalThis as any)[BOOT_GLOBAL];
    if (
        !raw ||
        typeof raw.panelId !== "string" ||
        raw.panelId.length === 0 ||
        typeof raw.token !== "string" ||
        raw.token.length === 0 ||
        !Number.isInteger(raw.port) ||
        raw.port <= 0
    ) {
        // a malformed boot context is a daemon bug — fail closed, loudly,
        // rather than guessing credentials from anywhere else
        console.error(
            "[paperapi] malformed service boot context refused (panelId/token/port required)",
        );
        return null;
    }
    return { panelId: raw.panelId, token: raw.token, port: raw.port };
}

function fromEnv(): ServiceBootContext | null {
    if (typeof process === "undefined" || !process.env) return null;
    const panelId = process.env.PAPERBOARD_PANEL_ID;
    const portRaw = process.env.PAPERCRANE_PORT;
    if (!panelId || !portRaw) return null;
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port <= 0) return null;
    // scoped token first: a service authenticates as its panel, not as the
    // host. The master token is the deprecated fallback (daemon-side loud
    // warning, denied after v3.2).
    const token =
        process.env.PAPERCRANE_PANEL_TOKEN || process.env.PAPERCRANE_TOKEN;
    if (!token) return null;
    return { panelId, token, port };
}

// Resolves the boot context exactly once per module instance. The in-process
// global is consumed at module init (it only exists during the import
// window); spawned-service env is captured on first need.
export function serviceBootContext(): ServiceBootContext | null {
    if (captured) return cached;
    const ctx = fromGlobal() ?? fromEnv();
    if (ctx) {
        cached = ctx;
        captured = true;
    }
    return cached;
}

// Explicit (re)capture for embedders and tests that set the boot context or
// env after this module initialized. Not part of the panel-facing surface.
export function captureServiceBootContext(): ServiceBootContext | null {
    const ctx = fromGlobal() ?? fromEnv();
    cached = ctx;
    captured = ctx !== null;
    return ctx;
}

// module init: claim the in-process boot window if it is open right now
const initial = fromGlobal();
if (initial) {
    cached = initial;
    captured = true;
}
