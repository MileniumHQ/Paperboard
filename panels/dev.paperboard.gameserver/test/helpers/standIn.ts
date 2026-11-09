// Compiles a stand-in program (a *.main.ts beside this file) into a native
// executable, once per test file, so the panel starts it the way it starts
// the real game: as a binary on disk, through the daemon.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const built = new Map<string, string>();
export const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** `<main>.main.ts` compiled to an executable named `name` */
export function standIn(main: string, name: string): string {
    const key = `${main}:${name}`;
    const done = built.get(key);
    if (done) return done;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gameserver-${main}-`));
    process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
    const out = path.join(dir, exe(name));
    const build = spawnSync(process.execPath, ["build", "--compile", path.join(import.meta.dir, `${main}.main.ts`), "--outfile", out], { encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(out)) {
        throw new Error(`Compiling the stand-in ${main} failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    built.set(key, out);
    return out;
}

/** copies the stand-in to `target`, executable */
export function placeStandIn(main: string, target: string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(standIn(main, path.basename(target).replace(/\.exe$/, "")), target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);
}
