#!/usr/bin/env bun
// The release smoke: the files a release ships for one target, run on that
// target the way someone who downloaded them would. The release workflow
// runs it on each target's own runner before anything reaches a release.
//
//   bun scripts/releaseSmoke.ts --target macos-arm64 --dir <staged release dir>
//
// For the server: unpack its archive, check its signature (macOS), boot it
// headless, prove its identity and answer as the release's version.
// For the app: unpack the installer the way the OS does (Archive Utility's
// ditto on macOS, the setup's own payload on Windows, the AppImage's
// filesystem on Linux), check the bundle's signature (macOS), launch it on
// a throwaway data dir and wait for the shell to list this computer.
// Anything off throws, with what the program printed.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { WebSocket } from "ws";
import { verifyDaemonProof, DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE } from "../apps/paperboard/papercrane/handshake";
import { CraneSocket, randomChallenge, readHandshake, startCrane, watch, WAIT_MS } from "../apps/paperboard/tests/platform/app/support/crane";
import { cleanupSuite, ownChild, tempDir } from "../apps/paperboard/tests/platform/app/support/temp";
import { ALL_TARGETS, archOf, assetFileName, osOf, type Target } from "./publishLib";

const APP_DIR = path.join(import.meta.dir, "..", "apps", "paperboard");
const VERSION = (JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")) as { version: string }).version;
const OS_NAME = { linux: "linux", darwin: "macos", win32: "windows" } as Record<string, string>;
const SHELL = "paperboard://shell/";

function parseArgs(argv: string[]): { target: Target; dir: string } {
    let target: string | null = null;
    let dir: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--target") target = argv[++i] ?? null;
        else if (argv[i] === "--dir") dir = argv[++i] ?? null;
        else throw new Error(`releaseSmoke: unknown argument ${argv[i]}`);
    }
    if (!target || !(ALL_TARGETS as string[]).includes(target)) {
        throw new Error(`releaseSmoke: --target must be one of ${ALL_TARGETS.join(", ")}, got ${JSON.stringify(target)}`);
    }
    if (!dir) throw new Error("releaseSmoke: --dir names the staged release files");
    return { target: target as Target, dir: path.resolve(dir) };
}

// the files' target is the machine's own: a smoke elsewhere proves nothing
function assertHost(target: Target): void {
    const host = `${OS_NAME[process.platform] ?? process.platform}-${process.arch}`;
    if (host !== target) throw new Error(`releaseSmoke: ${target} files must be run on ${target}, this is ${host}`);
}

async function run(cmd: string[], cwd?: string): Promise<string> {
    const child = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${out}${err}`);
    return out + err;
}

function shipped(dir: string, file: string): string {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new Error(`the release has no ${file} in ${dir}`);
    return full;
}

// A bundle or binary carries a valid signature over everything inside it.
// Ad-hoc is what an unnotarized release has; unsigned arm64 code is refused
// (or reported "damaged") by macOS.
async function verifyMacSignature(file: string): Promise<void> {
    await run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", file]);
    const details = await run(["codesign", "--display", "--verbose=2", file]);
    if (!/^Signature=/m.test(details)) throw new Error(`${file} is not signed:\n${details}`);
}

// ─── Server ─────────────────────────────────────────────────────────────────

async function smokeCrane(target: Target, dir: string): Promise<void> {
    const archive = shipped(dir, assetFileName("crane", target));
    const out = tempDir("smoke-crane");
    const binaryName = osOf(target) === "windows" ? `papercrane-${target}.exe` : `papercrane-${target}`;
    if (archive.endsWith(".zip")) new AdmZip(archive).extractAllTo(out, true);
    else await tar.x({ file: archive, cwd: out });
    const binary = path.join(out, binaryName);
    if (!fs.existsSync(binary)) throw new Error(`${path.basename(archive)} holds no ${binaryName}: ${fs.readdirSync(out).join(", ")}`);
    if (osOf(target) !== "windows" && (fs.statSync(binary).mode & 0o111) === 0) {
        throw new Error(`${binaryName} unpacks without its exec bit`);
    }
    if (osOf(target) === "macos") await verifyMacSignature(binary);

    const dataDir = tempDir("smoke-crane-data");
    const daemon = await startCrane(binary, dataDir);
    const challenge = randomChallenge();
    const probe = await CraneSocket.open(daemon.handshake.port, { [DAEMON_CHALLENGE_HEADER]: challenge });
    const proof = await probe.waitFrame("daemon proof", (f) => f.type === DAEMON_PROOF_TYPE);
    probe.close();
    if (!verifyDaemonProof(daemon.handshake.token, challenge, proof.proof)) throw new Error("the server's identity proof does not verify");
    const socket = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
    const info = await socket.call("system:info");
    socket.close();
    await daemon.stop();
    expectInfo("server", info, target);
    console.log(`✓ server ${path.basename(archive)}: v${info.version} on ${info.os}-${info.arch}`);
}

function expectInfo(what: string, info: { service?: string; version?: string; os?: string; arch?: string }, target: Target): void {
    const want = { service: "papercrane", version: VERSION, os: osOf(target), arch: archOf(target) };
    const got = { service: info.service, version: info.version, os: info.os, arch: info.arch };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`the ${what} answers ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
}

// ─── App ────────────────────────────────────────────────────────────────────

// The app's executable, unpacked from what the release ships.
async function unpackApp(target: Target, dir: string): Promise<string> {
    const installer = shipped(dir, assetFileName("pb", target));
    const out = tempDir("smoke-app");
    switch (osOf(target)) {
        case "macos": {
            // what Archive Utility does when the ZIP is opened
            await run(["ditto", "-x", "-k", installer, out]);
            const bundle = path.join(out, "Paperboard.app");
            if (!fs.existsSync(bundle)) throw new Error(`${path.basename(installer)} holds no Paperboard.app: ${fs.readdirSync(out).join(", ")}`);
            await verifyMacSignature(bundle);
            return path.join(bundle, "Contents", "MacOS", "Paperboard");
        }
        case "windows": {
            // the setup carries the app as one 7z payload, which it unpacks
            // into the install folder
            await run(["7z", "x", "-y", `-o${out}`, installer]);
            const payload = path.join(out, "$PLUGINSDIR", "app-64.7z");
            if (!fs.existsSync(payload)) throw new Error(`${path.basename(installer)} carries no app-64.7z payload`);
            const app = path.join(out, "app");
            await run(["7z", "x", "-y", `-o${app}`, payload]);
            return path.join(app, "paperboard.exe");
        }
        case "linux": {
            fs.chmodSync(installer, 0o755);
            await run([installer, "--appimage-extract"], out);
            // the binary itself, not the AppRun wrapper, so stopping it stops the app
            return path.join(out, "squashfs-root", "paperboard");
        }
    }
}

// The packaged app on a throwaway data dir, with Chromium's DevTools on a
// loopback port so the smoke can read the shell it shows.
async function smokeApp(target: Target, dir: string): Promise<void> {
    const executable = await unpackApp(target, dir);
    if (!fs.existsSync(executable)) throw new Error(`the unpacked app has no ${executable}`);
    const dataDir = tempDir("smoke-app-data");
    const env: NodeJS.ProcessEnv = { ...process.env, PAPERBOARD_DIR: dataDir };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    delete env.PAPERCRANE_PORT;
    const child = ownChild(spawn(executable, ["--skip-update", "--remote-debugging-port=0", `--user-data-dir=${tempDir("smoke-profile")}`], {
        env, stdio: ["ignore", "pipe", "pipe"],
    }));
    const app = watch(child, path.basename(executable));
    let devtools = "";
    await app.waitFor("DevTools address", (text) => {
        devtools = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/\S+)/.exec(text)?.[2] ?? "";
        return devtools !== "";
    });

    // textContent: a fresh profile opens on the welcome tutorial, which
    // covers the sidebar that lists this computer
    await untilShell(Number(devtools), `document.body?.textContent.includes("This Computer") === true`, app.output);

    // the daemon the app started answers as this release
    const handshake = readHandshake(dataDir);
    const socket = await CraneSocket.authed(handshake.port, handshake.token);
    const info = await socket.call("system:info");
    socket.close();
    expectInfo("app's server", info, target);

    child.kill();
    await app.exited;
    const errors = fs.readFileSync(path.join(dataDir, "logs", "paperboard.log"), "utf8").split("\n").filter((line) => line.includes("[ERROR]"));
    if (errors.length) throw new Error(`the app logged errors:\n${errors.join("\n")}`);
    console.log(`✓ app ${assetFileName("pb", target)}: shell up, server v${info.version}`);
}

// Polls the shell page until `expression` is true. The page is looked up
// afresh each time: while the app starts it can reload, which ends the
// page's context mid-evaluation.
async function untilShell(port: number, expression: string, output: () => string): Promise<void> {
    const deadline = Date.now() + WAIT_MS;
    let last = "the shell page never opened";
    while (Date.now() < deadline) {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (!res.ok) throw new Error(`DevTools /json/list answered ${res.status}`);
        const pages = (await res.json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
        const shell = pages.find((t) => t.type === "page" && t.url === `${SHELL}index.html`);
        if (!shell) last = `the shell page never opened; pages: ${JSON.stringify(pages.map((t) => t.url))}`;
        else {
            const reply = await evaluate(shell.webSocketDebuggerUrl, expression);
            if (reply.value === true) return;
            last = reply.error ?? `the shell never satisfied ${expression}; it shows: ${String((await evaluate(shell.webSocketDebuggerUrl, "document.body?.innerText.slice(0, 2000)")).value)}`;
        }
        await Bun.sleep(250);
    }
    throw new Error(`${last}\n${output()}`);
}

// One evaluation in a page over the DevTools protocol: its value, or why
// there is none (a thrown error, or the page navigating away mid-call)
function evaluate(wsUrl: string, expression: string): Promise<{ value?: unknown; error?: string }> {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
        ws.once("error", reject);
        ws.once("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } })));
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.id !== 1) return;
            ws.close();
            if (msg.error) resolve({ error: `Runtime.evaluate: ${msg.error.message}` });
            else if (msg.result.exceptionDetails) resolve({ error: `in the shell: ${msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text}` });
            else resolve({ value: msg.result.result.value });
        });
    });
}

async function main(): Promise<void> {
    const { target, dir } = parseArgs(process.argv.slice(2));
    assertHost(target);
    try {
        await smokeCrane(target, dir);
        await smokeApp(target, dir);
    } finally {
        cleanupSuite();
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
});
