// A real compiled PaperCrane daemon for tests that cross the process
// boundary: a supervisor respawns `process.execPath --supervise`, which under
// `bun test` is bare bun, so a daemon that starts workloads must be compiled.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ENTRY = path.resolve(import.meta.dir, "../papercrane/main.ts");

export async function compileCrane(into: string): Promise<string> {
    const bin = path.join(into, process.platform === "win32" ? "papercrane-test.exe" : "papercrane-test");
    const build = Bun.spawn([process.execPath, "build", "--compile", ENTRY, "--outfile", bin], {
        cwd: path.resolve(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`bun build --compile failed (${code}): ${err}`);
    return bin;
}

export interface CraneDaemon {
    proc: ReturnType<typeof Bun.spawn>;
    port: number;
    token: string;
    /** everything the daemon has written to stdout and stderr so far */
    output: () => string;
}

// the daemon stays alive, so its stdout never ends: read until the port line
export async function startCrane(bin: string, dir: string): Promise<CraneDaemon> {
    const proc = Bun.spawn([bin, "--headless", "--host", "127.0.0.1", "--port", "0"], {
        env: { ...process.env, PAPERBOARD_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
    });
    let out = "";
    const pump = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) out += new TextDecoder().decode(chunk);
    };
    void pump(proc.stdout as ReadableStream<Uint8Array>);
    void pump(proc.stderr as ReadableStream<Uint8Array>);
    const deadline = Date.now() + 15_000;
    for (;;) {
        const match = /Listening on https?:\/\/[^:]+:(\d+)/.exec(out);
        if (match) {
            const handshake = path.join(dir, "local", "crane.json");
            while (!fs.existsSync(handshake)) {
                if (Date.now() > deadline) throw new Error(`the daemon never wrote its handshake: ${out}`);
                await Bun.sleep(20);
            }
            const { token } = JSON.parse(fs.readFileSync(handshake, "utf8")) as { token: string };
            return { proc, port: Number(match[1]), token, output: () => out };
        }
        if (proc.exitCode !== null) throw new Error(`the daemon exited (${proc.exitCode}) before it listened: ${out}`);
        if (Date.now() > deadline) throw new Error(`the daemon did not report a listening port: ${out}`);
        await Bun.sleep(20);
    }
}

export function tempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
