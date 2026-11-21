import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { StoppedError, type Harness } from "trissue-embedded";
import { fetchReleaseSource, unpackAsarHarness, unpackedAsarPath } from "../../src/main/issueReportSource";
import { GITHUB_DESTINATION, defaultDestination, upsertConsoleEntry, type WrittenReport } from "../../src/renderer/src/components/settings/issueReportModel";

describe("fetchReleaseSource", () => {
    let workDir: string;
    let plainArchive: Buffer;
    let gitArchive: Buffer;
    let symlinkArchive: Buffer;
    let server: http.Server;
    let baseUrl: string;
    let slowChunkSent: (() => void) | null = null;
    let releaseSlowChunk: (() => void) | null = null;

    beforeAll(async () => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-issue-test-"));

        // plain tarball with a top-level prefix folder (no PAX commit comment)
        const plainRoot = path.join(workDir, "plain");
        fs.mkdirSync(path.join(plainRoot, "Paperboard-0.4.0", "src"), { recursive: true });
        fs.writeFileSync(path.join(plainRoot, "Paperboard-0.4.0", "README.md"), "# Paperboard\n");
        fs.writeFileSync(path.join(plainRoot, "Paperboard-0.4.0", "src", "index.ts"), "export const ok = true;\n");
        const plainFile = path.join(workDir, "plain.tar.gz");
        await tar.c({ gzip: true, file: plainFile, cwd: plainRoot }, ["Paperboard-0.4.0"]);
        plainArchive = fs.readFileSync(plainFile);

        // tarball with a symlink that must be skipped during extraction
        const symRoot = path.join(workDir, "sym");
        fs.mkdirSync(path.join(symRoot, "Paperboard-0.4.0"), { recursive: true });
        fs.writeFileSync(path.join(symRoot, "Paperboard-0.4.0", "safe.txt"), "hello");
        fs.symlinkSync("/etc/passwd", path.join(symRoot, "Paperboard-0.4.0", "escape"));
        const symFile = path.join(workDir, "sym.tar.gz");
        await tar.c({ gzip: true, file: symFile, cwd: symRoot }, ["Paperboard-0.4.0"]);
        symlinkArchive = fs.readFileSync(symFile);

        // real git archive tarball with a PAX global commit SHA comment, matching GitHub's format
        const gitArchiveFile = path.join(workDir, "git.tar.gz");
        execFileSync("git", ["archive", "--format=tar.gz", "--prefix=Paperboard-0.4.0/", "-o", gitArchiveFile, "HEAD", "README.md"], {
            cwd: path.resolve(import.meta.dir, "../../../.."),
        });
        gitArchive = fs.readFileSync(gitArchiveFile);

        server = http.createServer((req, res) => {
            if (req.url === "/MileniumHQ/Paperboard/archive/refs/tags/v0.4.0.tar.gz") {
                res.writeHead(200, { "content-type": "application/gzip" });
                res.end(gitArchive);
                return;
            }
            if (req.url === "/MileniumHQ/Paperboard/archive/refs/tags/v0.4.1.tar.gz") {
                res.writeHead(200, { "content-type": "application/gzip" });
                res.end(plainArchive);
                return;
            }
            if (req.url === "/MileniumHQ/Paperboard/archive/refs/tags/v0.4.2.tar.gz") {
                res.writeHead(200, { "content-type": "application/gzip" });
                res.end(symlinkArchive);
                return;
            }
            if (req.url === "/MileniumHQ/Paperboard/archive/refs/tags/v-slow.tar.gz") {
                res.writeHead(200, { "content-type": "application/gzip" });
                res.write(plainArchive.subarray(0, 16), () => slowChunkSent?.());
                releaseSlowChunk = () => {
                    if (!res.destroyed) res.end();
                };
                return;
            }
            res.writeHead(404);
            res.end("Not Found");
        });

        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === "string") throw new Error("Server did not bind to a port");
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        releaseSlowChunk?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    test("extracts a GitHub-style tarball, reads the PAX commit SHA, and cleans up on dispose", async () => {
        const source = await fetchReleaseSource("MileniumHQ/Paperboard", "v0.4.0", { baseUrl });
        try {
            expect(source.kind).toBe("remote");
            expect(source.github).toBe("MileniumHQ/Paperboard");
            expect(source.url).toBe(`${baseUrl}/MileniumHQ/Paperboard.git`);
            expect(source.ref).toBe("v0.4.0");
            expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
            expect(fs.existsSync(path.join(source.dir, "README.md"))).toBe(true);
        } finally {
            await source.dispose();
        }
        expect(fs.existsSync(source.dir)).toBe(false);
    });

    test("falls back to the tag name when the tarball has no PAX commit SHA", async () => {
        const source = await fetchReleaseSource("MileniumHQ/Paperboard", "v0.4.1", { baseUrl });
        try {
            expect(source.commit).toBe("v0.4.1");
            expect(fs.readFileSync(path.join(source.dir, "src", "index.ts"), "utf8")).toBe("export const ok = true;\n");
        } finally {
            await source.dispose();
        }
        expect(fs.existsSync(source.dir)).toBe(false);
    });

    test("skips symlinks inside the archive", async () => {
        const source = await fetchReleaseSource("MileniumHQ/Paperboard", "v0.4.2", { baseUrl });
        try {
            expect(fs.existsSync(path.join(source.dir, "safe.txt"))).toBe(true);
            expect(fs.existsSync(path.join(source.dir, "escape"))).toBe(false);
            expect(fs.lstatSync(path.join(source.dir, "safe.txt")).isFile()).toBe(true);
        } finally {
            await source.dispose();
        }
    });

    test("surfaces HTTP errors clearly", async () => {
        await expect(fetchReleaseSource("MileniumHQ/Paperboard", "v9.9.9", { baseUrl })).rejects.toThrow(/HTTP 404/);
    });

    test("enforces the archive byte cap", async () => {
        await expect(fetchReleaseSource("MileniumHQ/Paperboard", "v0.4.1", { baseUrl, maxBytes: 10 })).rejects.toThrow(/larger than expected/);
    });

    test("cancels an in-flight download with StoppedError", async () => {
        const abort = new AbortController();
        const firstChunk = new Promise<void>((resolve) => {
            slowChunkSent = resolve;
        });
        const pending = fetchReleaseSource("MileniumHQ/Paperboard", "v-slow", { baseUrl, signal: abort.signal });
        await firstChunk;
        abort.abort();
        releaseSlowChunk?.();
        await expect(pending).rejects.toBeInstanceOf(StoppedError);
    });
});

describe("unpackAsarHarness", () => {
    const fakeHarness = (args: string[]): Harness => ({
        id: "codex",
        name: "Codex",
        brand: null,
        protocol: "acp",
        executable: "/usr/local/bin/codex",
        launch: { command: "/app/Paperboard", args, env: { ELECTRON_RUN_AS_NODE: "1" } },
    });

    test("rewrites app.asar paths to app.asar.unpacked when the unpacked file exists", () => {
        const posix = "/opt/Paperboard/resources/app.asar/node_modules/trissue-embedded/dist/adapters/codex.mjs";
        const expectedPosix = "/opt/Paperboard/resources/app.asar.unpacked/node_modules/trissue-embedded/dist/adapters/codex.mjs";
        expect(unpackedAsarPath(posix, (candidate) => candidate === expectedPosix)).toBe(expectedPosix);

        const win = "C:\\Program Files\\Paperboard\\resources\\app.asar\\node_modules\\trissue-embedded\\dist\\adapters\\codex.mjs";
        const expectedWin = "C:\\Program Files\\Paperboard\\resources\\app.asar.unpacked\\node_modules\\trissue-embedded\\dist\\adapters\\codex.mjs";
        expect(unpackedAsarPath(win, (candidate) => candidate === expectedWin)).toBe(expectedWin);

        const unpacked = unpackAsarHarness(fakeHarness([posix, "--flag"]), true, (candidate) => candidate === expectedPosix);
        expect(unpacked.launch.args).toEqual([expectedPosix, "--flag"]);
    });

    test("leaves paths alone when unpackaged or when no unpacked twin exists", () => {
        const posix = "/opt/Paperboard/resources/app.asar/node_modules/trissue-embedded/dist/adapters/codex.mjs";
        const original = fakeHarness([posix]);
        expect(unpackAsarHarness(original, false, () => true)).toBe(original);
        expect(unpackAsarHarness(original, true, () => false).launch.args).toEqual([posix]);
    });
});

describe("issueReportModel", () => {
    test("upsertConsoleEntry preserves untouched row identities and skips no-op pushes", () => {
        const list1 = upsertConsoleEntry([], { reportId: "r1", id: "e0", kind: "tool", text: "Read App.tsx", status: "in_progress" });
        const list2 = upsertConsoleEntry(list1, { reportId: "r1", id: "e1", kind: "message", text: "Looking at App.tsx" });
        expect(list2[0]).toBe(list1[0]);
        expect(list2[1]).toEqual({ id: "e1", type: "output", content: "Looking at App.tsx", markdown: true });

        // streaming chunk updates only e1; e0 keeps its exact object reference
        const list3 = upsertConsoleEntry(list2, { reportId: "r1", id: "e1", kind: "message", text: "Looking at App.tsx\nFound it." });
        expect(list3).not.toBe(list2);
        expect(list3[0]).toBe(list2[0]);
        expect(list3[1]).not.toBe(list2[1]);
        expect(list3[1].content).toBe("Looking at App.tsx\nFound it.");

        // duplicate push changes nothing and returns the exact same array
        const list4 = upsertConsoleEntry(list3, { reportId: "r1", id: "e1", kind: "message", text: "Looking at App.tsx\nFound it." });
        expect(list4).toBe(list3);

        // failed tool maps to error, blocked maps to warn, steer maps to command
        const list5 = upsertConsoleEntry(list4, { reportId: "r1", id: "e0", kind: "tool", text: "Read App.tsx", status: "failed" });
        expect(list5[0].type).toBe("error");
        expect(list5[1]).toBe(list4[1]);
    });

    test("defaultDestination prefers signed-in GitHub and falls back on error or missing CLI", () => {
        const base: Omit<WrittenReport, "github"> = { status: "written", title: "T", body: "B", text: "T\nB" };
        const links = [{ label: "Discord", description: "Opens Discord.", includesIssue: false }];
        expect(defaultDestination({ ...base, github: { repo: "MileniumHQ/Paperboard", state: "signed-in", login: "pxl" } }, links)).toBe(
            GITHUB_DESTINATION,
        );
        expect(defaultDestination({ ...base, github: { repo: "MileniumHQ/Paperboard", state: "missing" } }, links)).toBe("link:0");
        expect(defaultDestination({ ...base, github: { repo: "MileniumHQ/Paperboard", state: "error", error: "offline" } }, links)).toBe("link:0");
        expect(defaultDestination({ ...base, github: null }, [])).toBeNull();
    });
});
