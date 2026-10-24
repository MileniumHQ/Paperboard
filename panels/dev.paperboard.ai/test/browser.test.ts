// The browser computer's own contract, without a browser: its lifecycle against
// the daemon's process API, what it accepts as a web address, the keys it
// sends, and the home folder it never leaves. Driving a real Helium is the
// live check (see the commit that added this file); here the daemon is faked.
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BROWSER_PROC_ID, BrowserComputer, siteOf, webAddress, type ComputerHost } from "../src/service/browser";
import type { ComputerState } from "../src/contract";
import { HomeFolder } from "../src/service/homeFolder";
import { chord } from "../src/service/keys";
import { FakeProcesses, until } from "./fakeHost";

const dirs: string[] = [];
const tempDir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ai-browser-"));
    dirs.push(d);
    return d;
};
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(o: { platform?: NodeJS.Platform; arch?: string } = {}) {
    const procs = new FakeProcesses();
    const dir = tempDir();
    const states: ComputerState[] = [];
    const downloads: string[] = [];
    const host: ComputerHost = {
        start: procs.start,
        kill: procs.kill,
        exists: procs.exists,
        onExit: procs.onExit,
        onStderr: procs.onStderr,
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        download: async (d) => void downloads.push(d.url),
        which: () => null,
    };
    const computer = new BrowserComputer({ host, dir, storagePath: "browser", onState: (s) => states.push(s), platform: o.platform ?? "linux", arch: o.arch ?? "x64", startMs: 300 });
    return { procs, dir, states, downloads, computer };
}

describe("the browser computer's lifecycle", () => {
    test("never set up: nothing starts, and the agent is told how to get one", async () => {
        const t = setup();
        await t.computer.init();
        expect(t.computer.state).toMatchObject({ phase: "none", installed: false });
        expect(t.procs.started).toHaveLength(0);
        expect(await t.computer.callTool("open", { what: "example.com" })).toEqual({ isError: true, text: expect.stringMatching(/don't have a computer yet/) });
    });

    test("an unreadable record fails visibly and is left as it is", async () => {
        const t = setup();
        fs.writeFileSync(path.join(t.dir, "browser.json"), "{nope");
        await t.computer.init();
        expect(t.computer.state.phase).toBe("failed");
        expect(t.computer.state.error).toMatch(/unreadable/);
        expect(fs.readFileSync(path.join(t.dir, "browser.json"), "utf8")).toBe("{nope");
        expect(t.procs.started).toHaveLength(0);
    });

    test("no build for this machine: unsupported, with why", async () => {
        const t = setup({ platform: "freebsd" });
        await t.computer.init();
        expect(t.computer.state).toMatchObject({ phase: "unsupported", error: expect.stringMatching(/freebsd/) });
    });

    test("a browser that exits before it's ready fails the start, with its own words, and none is left running", async () => {
        const t = setup();
        fs.writeFileSync(path.join(t.dir, "browser.json"), JSON.stringify({ version: 1, installed: true, helium: "0.20.1.1" }));
        const exe = path.join(t.dir, "helium-0.20.1.1", "helium");
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        fs.writeFileSync(exe, "");
        t.procs.onStart = (o) => {
            queueMicrotask(() => {
                t.procs.exit(o.id, 1);
            });
        };
        expect(t.computer.init()).rejects.toThrow(/browser stopped/);
        await until(() => t.computer.state.phase === "failed");
        expect(t.procs.started[0]).toMatchObject({ id: BROWSER_PROC_ID, command: exe });
        expect(t.procs.started[0]!.args).toContain("--proxy-bypass-list=<-loopback>");
        expect(t.procs.started[0]!.args).not.toContain("--no-sandbox");
        expect(t.procs.alive.has(BROWSER_PROC_ID)).toBe(false);
    });

    test("a sandbox refusal is explained, never worked around", async () => {
        const t = setup();
        fs.writeFileSync(path.join(t.dir, "browser.json"), JSON.stringify({ version: 1, installed: true, helium: "0.20.1.1" }));
        const exe = path.join(t.dir, "helium-0.20.1.1", "helium");
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        fs.writeFileSync(exe, "");
        // the refusal Ubuntu 24.04 gives a Chromium its AppArmor profile doesn't cover
        t.procs.onStart = (o) => {
            queueMicrotask(() => {
                t.procs.stderr(o.id, "FATAL:zygote_host_impl_linux.cc No usable sandbox! You are probably running on Ubuntu 23.10+");
                t.procs.exit(o.id, 1);
            });
        };
        expect(t.computer.init()).rejects.toThrow(/won't let the browser use its sandbox/);
        await until(() => t.computer.state.phase === "failed");
        expect(t.procs.started).toHaveLength(1);
    });

    test("setting up again erases what was on it, only after the browser is observed stopped", async () => {
        const t = setup();
        await t.computer.init();
        fs.mkdirSync(path.join(t.dir, "home", "Downloads"), { recursive: true });
        fs.writeFileSync(path.join(t.dir, "home", "Downloads", "kept.txt"), "x");
        fs.mkdirSync(path.join(t.dir, "profile"), { recursive: true });
        t.procs.alive.add(BROWSER_PROC_ID); // a browser the last service left running
        let seenWhileRunning = false;
        const kill = t.procs.kill;
        t.procs.kill = async (id, signal) => {
            seenWhileRunning ||= !fs.existsSync(path.join(t.dir, "profile"));
            return kill(id, signal);
        };
        // the fake download has no archive to unpack
        expect(t.computer.install()).rejects.toThrow();
        await until(() => t.computer.state.phase === "failed");
        expect(seenWhileRunning).toBe(false);
        expect(t.procs.killed[0]).toMatchObject({ id: BROWSER_PROC_ID, signal: "SIGTERM" });
        expect(fs.existsSync(path.join(t.dir, "home"))).toBe(false);
        expect(fs.existsSync(path.join(t.dir, "profile"))).toBe(false);
        expect(t.downloads).toHaveLength(1);
        expect(t.computer.state).toMatchObject({ phase: "failed", installed: false });
    });
});

describe("what the agent can open", () => {
    test("web addresses, made whole; anything else is refused with what to do", () => {
        expect(webAddress("example.com", true)).toBe("https://example.com/");
        expect(webAddress("news.ycombinator.com/item?id=1", false)).toBe("https://news.ycombinator.com/item?id=1");
        expect(webAddress("http://example.com/a", false)).toBe("http://example.com/a");
        expect(webAddress("browser", true)).toBe("about:blank");
        expect(() => webAddress("browser", false)).toThrow(/web address/);
        expect(() => webAddress("mousepad notes.txt", true)).toThrow(/your computer is a web browser/);
        expect(() => webAddress("file:///etc/passwd", true)).toThrow();
        expect(() => webAddress("javascript:alert(1)", true)).toThrow();
    });

    test("a sign-in names the site the user sees: the host, and the scheme only when it isn't https", () => {
        expect(siteOf("https://accounts.example.com/login?x=1")).toBe("accounts.example.com");
        expect(siteOf("http://example.com/")).toBe("http://example.com");
        expect(() => siteOf("about:blank")).toThrow();
        expect(() => siteOf("data:text/html,hi")).toThrow();
    });
});

describe("keys", () => {
    test("a chord holds its modifiers around the key, and only plain keys type", () => {
        const ev = chord("ctrl+shift+t", "linux") as Record<string, unknown>[];
        expect(ev.map((e) => [e.type, e.key])).toEqual([
            ["rawKeyDown", "Control"],
            ["rawKeyDown", "Shift"],
            ["rawKeyDown", "T"],
            ["keyUp", "T"],
            ["keyUp", "Shift"],
            ["keyUp", "Control"],
        ]);
        expect(ev[2]).not.toHaveProperty("text");
        expect((chord("Return", "linux") as Record<string, unknown>[])[0]).toMatchObject({ type: "keyDown", key: "Enter", text: "\r" });
    });

    test("on macOS ctrl's editing shortcuts are the browser's commands", () => {
        const ev = chord("ctrl+a", "darwin") as Record<string, unknown>[];
        expect(ev.find((e) => e.key === "a")).toMatchObject({ commands: ["selectAll"] });
    });

    test("anything that isn't a key name is refused", () => {
        expect(chord("rm -rf", "linux")).toEqual(expect.stringMatching(/isn't a key/));
        expect(chord("hyper+x", "linux")).toEqual(expect.stringMatching(/isn't a modifier/));
        expect(chord("Banana", "linux")).toEqual(expect.stringMatching(/isn't a key name/));
    });
});

describe("the home folder", () => {
    test("paths stay inside it, links included", () => {
        const root = tempDir();
        const home = new HomeFolder(path.join(root, "home"));
        home.ensure();
        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "secret"), "s");
        fs.symlinkSync(outside, path.join(root, "home", "out"));
        expect(() => home.resolve("~/../outside/secret")).toThrow(/home folder/);
        expect(() => home.resolve("/etc/passwd")).toThrow(/home folder/);
        expect(() => home.read("~/out/secret")).toThrow(/home folder/);
        expect(() => home.write("~/out/new", Buffer.from("x"))).toThrow(/home folder/);
        expect(fs.existsSync(path.join(outside, "new"))).toBe(false);
        expect(home.write("~/notes/a.txt", Buffer.from("hi"))).toBe("~/notes/a.txt");
        expect(home.read("~/notes/a.txt").data.toString()).toBe("hi");
    });

    test("a download gets a name no file has, from what the site suggested", () => {
        const home = new HomeFolder(path.join(tempDir(), "home"));
        home.ensure();
        const first = home.downloadName("../../report.pdf");
        expect(path.basename(first)).toBe("report.pdf");
        fs.writeFileSync(first, "");
        expect(path.basename(home.downloadName("report.pdf"))).toBe("report (1).pdf");
        expect(path.basename(home.downloadName("..."))).toBe("download");
    });
});
