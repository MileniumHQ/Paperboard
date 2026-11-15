// What the browser is on disk: its program (the daemon's helium package), the
// computer's record of it, and the settings seeded into its profile. Running
// it is browser.ts.

import fs from "node:fs";
import path from "node:path";
import type { SetupStep, SetupStepId } from "../contract";
import { HELIUM_PACKAGE, findExecutable } from "./helium";
import { writeAtomic } from "./writeAtomic";

export const RECORD_FILE = "browser.json";
const RECORD_VERSION = 1;

export interface PackageHost {
    isInstalled(name: string): Promise<boolean>;
    download(name: string, onProgress?: (p: { stage: string; percent: number; bytesLoaded?: number; bytesTotal?: number }) => void): Promise<unknown>;
    getPath(name: string): Promise<string>;
}

export interface BrowserRecord {
    version: typeof RECORD_VERSION;
    installed: boolean;
    /** the Chromium major the browser last reported: its user agent says the same */
    chromium: number | null;
}

export const NO_RECORD: BrowserRecord = { version: RECORD_VERSION, installed: false, chromium: null };

export function readRecord(dir: string): BrowserRecord {
    const file = path.join(dir, RECORD_FILE);
    let raw: string;
    try {
        raw = fs.readFileSync(file, "utf8");
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return NO_RECORD;
        throw e;
    }
    let r: Partial<BrowserRecord>;
    try {
        r = JSON.parse(raw);
    } catch {
        throw new Error(`The computer's record (${file}) is unreadable; it was left as it is. Set the computer up again to replace it.`);
    }
    return { version: RECORD_VERSION, installed: r.installed === true, chromium: Number.isInteger(r.chromium) ? r.chromium! : null };
}

export function writeRecord(dir: string, record: BrowserRecord) {
    writeAtomic(path.join(dir, RECORD_FILE), JSON.stringify(record, null, 2));
}

/** the browser's program in the helium package, or null while it isn't installed */
export async function executable(packages: PackageHost): Promise<string | null> {
    if (!(await packages.isInstalled(HELIUM_PACKAGE))) return null;
    return findExecutable(path.join(await packages.getPath(HELIUM_PACKAGE), "bin"));
}

/** The daemon fetches the helium package (or finds it current) and unpacks it by its recipe. */
export async function fetchHelium(packages: PackageHost, dir: string, signal: AbortSignal, step: (id: SetupStepId, patch: Partial<SetupStep>) => void) {
    step("download", { status: "running", percent: 0 });
    let unpacking = false;
    await packages.download(HELIUM_PACKAGE, (p) => {
        if (p.stage === "downloading") {
            const bytes = p.bytesLoaded !== undefined && p.bytesTotal ? { done: p.bytesLoaded, total: p.bytesTotal } : null;
            step("download", { percent: Math.round(p.percent), bytes });
        }
        else if (p.stage === "extracting" && !unpacking) {
            unpacking = true;
            step("download", { status: "done", percent: 100, bytes: null });
            step("unpack", { status: "running" });
        }
    });
    step("download", { status: "done", percent: 100, bytes: null });
    step("unpack", { status: "done" });
    if (signal.aborted) throw new Error("setup was stopped");
    if (!(await executable(packages))) throw new Error("The browser package has no program in it.");
    // the browser this panel used to unpack into its own folder, before it was a package
    for (const old of fs.readdirSync(dir)) {
        if (/^helium-[\d.]+(\.partial)?$/.test(old)) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    }
}

/**
 * The profile's own settings that keep the browser to its proxy and ready to use: WebRTC sends no UDP
 * around the proxy (its command-line switch is ignored; this pref is not), and Helium's first-run page
 * is done, with Helium's services off. Local State, shared by the profile's people, turns Helium's crash
 * reporting off, which also discards any reports it kept. The browser owns the rest of each file; an unreadable one is left alone
 * and starting stops.
 */
export function seedPreferences(profile: string) {
    editSettings(path.join(profile, "Default", "Preferences"), (prefs) => {
        prefs.webrtc = { ...prefs.webrtc, ip_handling_policy: "disable_non_proxied_udp", multiple_routes_enabled: false, nonproxied_udp_enabled: false };
        // Helium's own cloud (filter lists, bangs, update checks, push, spellcheck, extension proxy) stays off, and
        // pages are told not to sell or share what they see (Global Privacy Control)
        prefs.helium = { ...prefs.helium, completed_onboarding: true, global_privacy_control: true, services: { ...prefs.helium?.services, enabled: false } };
        prefs.browser = { ...prefs.browser, has_seen_welcome_page: true };
        prefs.download = { ...prefs.download, prompt_for_download: false };
    });
    editSettings(path.join(profile, "Local State"), (state) => {
        // Helium's CrashReportingMode: -1 disabled, 0 ask, 1 automatic
        state.helium = { ...state.helium, crash_reporting: { ...state.helium?.crash_reporting, mode: -1 } };
    });
}

function editSettings(file: string, edit: (settings: Record<string, any>) => void) {
    let settings: Record<string, any> = {};
    if (fs.existsSync(file)) {
        try {
            settings = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
            throw new Error(`The browser's settings (${file}) are unreadable; they were left as they are.`);
        }
    }
    edit(settings);
    writeAtomic(file, JSON.stringify(settings));
}
