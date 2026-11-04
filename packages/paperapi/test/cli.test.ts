// The `paperapi` command line as a developer runs it: a real process, a real
// panel folder, and a throwaway PAPERBOARD_DIR. Covers what every command
// prints, where, and with which exit code (0 done, 1 failed, 2 usage). The
// commands that need a running daemon are proved against a real one in
// apps/paperboard/tests/trafficMonitor.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "child_process";
import { once } from "events";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/cli.ts");
const ID = "dev.test.cli";

let root: string;
let data: string;
let panel: string;

function run(args: string[], cwd = root) {
    const env: Record<string, string | undefined> = { ...process.env, PAPERBOARD_DIR: data, NO_COLOR: "1" };
    delete env.FORCE_COLOR;
    const proc = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
    return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

function writePanel(manifest: Record<string, unknown> = {}, built = true) {
    fs.mkdirSync(path.join(panel, "src"), { recursive: true });
    fs.writeFileSync(path.join(panel, "manifest.json"), JSON.stringify({ id: ID, name: "CLI Test", version: "0.1.0", ...manifest }));
    fs.writeFileSync(path.join(panel, "src", "index.ts"), "export {};\n");
    if (built) {
        fs.mkdirSync(path.join(panel, "dist"), { recursive: true });
        fs.writeFileSync(path.join(panel, "dist", "index.html"), "<!doctype html>");
        // the build is newer than its source
        const later = new Date(Date.now() + 1000);
        fs.utimesSync(path.join(panel, "dist", "index.html"), later, later);
    }
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "paperapi-cli-")));
    data = path.join(root, "data");
    panel = path.join(root, "work", ID);
    fs.mkdirSync(panel, { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("exit codes", () => {
    test("a command line the CLI cannot read exits 2 and says why", () => {
        const badJson = run(["call", ID, "greet", "{name:"]);
        expect(badJson.code).toBe(2);
        expect(badJson.stderr).toContain("✗ The inputs are not JSON");
        expect(badJson.stderr).toContain("Pass one JSON value");

        const badId = run(["call", "Not An Id", "greet"]);
        expect(badId.code).toBe(2);
        expect(badId.stderr).toContain('✗ "Not An Id" is not a panel id');

        const badTimeout = run(["call", ID, "greet", "--timeout", "70000"]);
        expect(badTimeout.code).toBe(2);
        expect(badTimeout.stderr).toContain("--timeout must be a whole number of milliseconds from 1 to 60000");

        expect(run(["monitor", "--panel", "../escape"]).code).toBe(2);
        expect(run(["no-such-command"]).code).toBe(2);
    });

    test("--help and --version exit 0", () => {
        const help = run(["--help"]);
        expect(help.code).toBe(0);
        for (const name of ["link", "unlink", "links", "doctor", "monitor", "call", "restart", "pack"]) expect(help.stdout).toContain(name);
        expect(run(["--version"]).code).toBe(0);
    });

    test("a command that needs Paperboard exits 1 and names the handshake it looked for", () => {
        for (const args of [["monitor"], ["call", ID, "greet"], ["restart", ID]]) {
            const result = run(args);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain(`✗ Paperboard isn't running: there is no ${path.join(data, "local", "crane.json")}`);
            expect(result.stderr).toContain("set PAPERBOARD_DIR");
        }
    });

    test("a stale handshake is refused, never sent the token", async () => {
        // a port nothing listens on, as a daemon that stopped leaves behind
        const server = net.createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.mkdirSync(path.join(data, "local"), { recursive: true });
        fs.writeFileSync(path.join(data, "local", "crane.json"), JSON.stringify({ port, token: "t".repeat(48) }));
        const result = run(["monitor"]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`✗ Paperboard isn't running: nothing listens on 127.0.0.1:${port}`);
    });
});

describe("link, links and unlink work on PAPERBOARD_DIR", () => {
    test("link links the folder into PAPERBOARD_DIR and says where", () => {
        writePanel();
        const linked = run(["link"], panel);
        expect(linked.code).toBe(0);
        expect(linked.stderr).toContain(`✓ Linked CLI Test (${ID})`);
        expect(linked.stdout).toBe(`${path.join(data, "panels", ID)} → .\n`);
        expect(fs.realpathSync(path.join(data, "panels", ID))).toBe(panel);
        // a panel with no service has none to restart
        expect(linked.stderr).toContain("Paperboard serves its pages from this folder now.\n");
        expect(linked.stderr.includes("paperapi restart")).toBe(false);

        const listed = run(["links"]);
        expect(listed.code).toBe(0);
        expect(listed.stderr).toContain(`1 development link in ${path.join(data, "panels")}`);
        expect(listed.stdout).toContain(`${ID}  → ${panel}`);
        expect(JSON.parse(run(["links", "--json"]).stdout)).toEqual([{ id: ID, targetPath: panel, isBroken: false }]);

        const unlinked = run(["unlink", ID]);
        expect(unlinked.code).toBe(0);
        expect(unlinked.stderr).toContain(`✓ Unlinked ${ID}`);
        expect(fs.existsSync(path.join(data, "panels", ID))).toBe(false);
    });

    test("link says to restart the service of a panel that has one", () => {
        writePanel({ service: "./dist/service.js" });
        const linked = run(["link"], panel);
        expect(linked.code).toBe(0);
        expect(linked.stderr).toContain("run paperapi restart to run the new service");
    });

    test("links names the data folder it looked in, not ~/.paperboard", () => {
        const listed = run(["links"]);
        expect(listed.code).toBe(0);
        expect(listed.stderr).toBe(`No development links in ${path.join(data, "panels")}.\n`);
    });

    test("unlinking a panel with no link fails, naming where it looked", () => {
        const result = run(["unlink", ID]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`✗ ${ID} has no development link in ${path.join(data, "panels")}`);
    });

    test("link refuses to replace an installed copy without --force, and says how", () => {
        writePanel();
        fs.mkdirSync(path.join(data, "panels", ID), { recursive: true });
        const refused = run(["link", panel]);
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain(`An installed copy of ${ID} already exists`);
        expect(refused.stderr).toContain("--force");
        expect(run(["link", panel, "--force"]).code).toBe(0);
        expect(fs.realpathSync(path.join(data, "panels", ID))).toBe(panel);
    });
});

describe("doctor", () => {
    test("names each problem with the command that fixes it", () => {
        writePanel({}, false);
        const result = run(["doctor", panel]);
        expect(result.code).toBe(1);
        expect(result.stdout).toContain("✓ Manifest    CLI Test 0.1.0");
        expect(result.stdout).toContain("✗ Build       dist/index.html is missing");
        expect(result.stdout).toContain("→ bun run build");
        expect(result.stdout).toContain(`✗ Link        not linked into ${path.join(data, "panels")}`);
        expect(result.stdout).toContain("→ paperapi link");
        expect(result.stdout).toContain("✗ Paperboard  isn't running");
        expect(result.stdout).toContain("3 problems.");
    });

    test("warns about source changed after the last build", () => {
        writePanel();
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(path.join(panel, "src", "index.ts"), later, later);
        const report = JSON.parse(run(["doctor", "--json"], panel).stdout);
        expect(report.checks.find((c: { name: string }) => c.name === "Build")).toEqual({
            name: "Build", status: "warn", detail: "src/index.ts changed after the last build", fix: "bun run build",
        });
    });

    test("tells an installed copy apart from a link to another folder", () => {
        writePanel();
        fs.mkdirSync(path.join(data, "panels", ID), { recursive: true });
        const installed = JSON.parse(run(["doctor", "--json", panel]).stdout);
        const installedLink = installed.checks.find((c: { name: string }) => c.name === "Link");
        expect(installedLink.status).toBe("fail");
        expect(installedLink.fix).toContain("paperapi link --force");

        fs.rmSync(path.join(data, "panels", ID), { recursive: true });
        const elsewhere = path.join(root, "elsewhere");
        fs.mkdirSync(elsewhere);
        fs.symlinkSync(elsewhere, path.join(data, "panels", ID), "dir");
        const linkedElsewhere = JSON.parse(run(["doctor", "--json", panel]).stdout);
        const elsewhereLink = linkedElsewhere.checks.find((c: { name: string }) => c.name === "Link");
        expect(elsewhereLink.status).toBe("fail");
        expect(elsewhereLink.detail).toContain(`points at another folder: ${elsewhere}`);
    });

    test("refuses a manifest the daemon would refuse", () => {
        writePanel({ id: "Bad Id" });
        const bad = run(["doctor", panel]);
        expect(bad.code).toBe(1);
        expect(bad.stdout).toContain('✗ Manifest  "id": Invalid panel id');

        writePanel({ service: "../outside.js" });
        expect(run(["doctor", panel]).stdout).toContain('"service" must stay inside the panel folder: ../outside.js');
    });

    test("says so when run outside a panel folder", () => {
        const result = run(["doctor"], root);
        expect(result.code).toBe(1);
        expect(result.stdout).toContain(`there is no manifest.json in ${root}`);
    });

    // `paperapi doctor | head`: the reader closes stdout before the report
    // ends, and the command used to crash on the write with EPIPE
    test("stops quietly with its own exit code when the reader closes stdout", async () => {
        writePanel();
        const expected = run(["doctor", panel]).code;
        for (const runtime of [process.execPath, "node"]) {
            const script = runtime === "node" ? path.resolve(path.dirname(CLI), "../dist/cli.js") : CLI;
            if (runtime === "node" && !fs.existsSync(script)) throw new Error(`build the CLI first: ${script} is missing`);
            const env: Record<string, string | undefined> = { ...process.env, PAPERBOARD_DIR: data, NO_COLOR: "1" };
            delete env.FORCE_COLOR;
            const child = spawn(runtime, [script, "doctor", panel], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
            // nothing reads stdout: every write the command makes fails
            child.stdout.destroy();
            let stderr = "";
            child.stderr.on("data", (chunk) => (stderr += chunk));
            const [code] = (await once(child, "close")) as [number | null];
            expect(stderr.includes("EPIPE")).toBe(false);
            expect([runtime, code]).toEqual([runtime, expected]);
        }
    });
});

describe("pack", () => {
    test("prints the archive and its sha256, or only JSON with --json", () => {
        writePanel();
        const packed = run(["pack", panel, "--out", path.join(root, "out")]);
        expect(packed.code).toBe(0);
        expect(packed.stderr).toContain(`✓ Packed ${ID} 0.1.0`);
        // plain text a terminal and a log both show: no ellipsis character
        expect(packed.stderr).toContain("Archiving manifest.json, dist\n");
        expect(packed.stderr.includes("\u2026")).toBe(false);
        // shown relative to where the developer is
        expect(packed.stdout).toMatch(new RegExp(`^out/${ID}-0\\.1\\.0\\.tar\\.gz\\nsha256 [a-f0-9]{64}\\n$`));

        const json = run(["pack", panel, "--out", path.join(root, "out"), "--json"]);
        expect(json.code).toBe(0);
        expect(JSON.parse(json.stdout)).toMatchObject({ id: ID, version: "0.1.0", archiveName: `${ID}-0.1.0.tar.gz` });
    });

    test("a manifest pack refuses exits 1 with the reason", () => {
        writePanel({ version: undefined });
        const result = run(["pack", panel]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("✗ Panel manifest must specify a 'version'");
    });
});
