// The agent's home folder: a real folder in the panel's storage holding its
// downloads, the files it's given and whatever it makes in its shell. The
// agent names files as ~/… (its shell's /home/user is the same folder);
// every path is resolved inside the folder, links included, and nothing
// outside it is ever read or written. The host's own path is never shown to
// the agent.

import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../contract";

/** Where the home folder is in the agent's shell: its $HOME. */
export const SHELL_HOME = "/home/user";

export class HomeFolder {
    constructor(readonly root: string) {}

    ensure() {
        fs.mkdirSync(path.join(this.root, "Downloads"), { recursive: true });
    }

    /** The host path for one of the agent's paths, or why it can't be used. Nothing is followed outside the folder. */
    resolve(p: unknown): string {
        if (typeof p !== "string" || !p.trim() || p.includes("\0")) throw new Error("give the file's path");
        let rel = p.trim().replace(/\\/g, "/");
        if (rel === "~" || rel === SHELL_HOME) rel = "";
        else if (rel.startsWith("~/")) rel = rel.slice(2);
        else if (rel.startsWith(`${SHELL_HOME}/`)) rel = rel.slice(SHELL_HOME.length + 1);
        else if (rel.startsWith("/")) throw new Error("paths are in your home folder: ~/…");
        const root = fs.realpathSync(this.root);
        const full = path.resolve(root, rel);
        if (full !== root && !full.startsWith(root + path.sep)) throw new Error("only files in your home folder (~) can be used");
        // the deepest part that exists, with its links followed, must still be inside
        let probe = full;
        while (!fs.existsSync(probe)) probe = path.dirname(probe);
        const real = fs.realpathSync(probe);
        if (real !== root && !real.startsWith(root + path.sep)) throw new Error("only files in your home folder (~) can be used");
        return full;
    }

    /** How the agent sees a host path inside the folder. */
    shown(full: string): string {
        const rel = path.relative(fs.realpathSync(this.root), full).split(path.sep).join("/");
        return rel ? `~/${rel}` : "~";
    }

    read(p: unknown): { path: string; data: Buffer } {
        const full = this.resolve(p);
        const st = fs.statSync(full, { throwIfNoEntry: false });
        if (!st?.isFile()) throw new Error(`there's no file at ${this.shown(full)}`);
        if (st.size > LIMITS.attachments.fileBytes) {
            throw new Error(`${this.shown(full)} is ${Math.round(st.size / 1024 / 1024)} MB; files up to ${LIMITS.attachments.fileBytes / 1024 / 1024} MB can be shared`);
        }
        return { path: this.shown(full), data: fs.readFileSync(full) };
    }

    write(p: unknown, data: Buffer): string {
        const full = this.resolve(p);
        if (full === fs.realpathSync(this.root)) throw new Error("give the file's name, not just ~");
        if (fs.lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${this.shown(full)} is a link; pick another name`);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        this.resolve(p); // the folders just made are still inside
        const tmp = `${full}.${process.pid}.partial`;
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, full);
        return this.shown(full);
    }

    /** Delete everything in it, links as links (never what they point to), and start it again empty. */
    erase() {
        for (const name of fs.existsSync(this.root) ? fs.readdirSync(this.root) : []) {
            fs.rmSync(path.join(this.root, name), { recursive: true, force: true });
        }
        this.ensure();
    }

    /** A name in ~/Downloads no file has yet, from what a site suggested. */
    downloadName(suggested: string): string {
        const clean = (suggested.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim().slice(0, LIMITS.attachments.nameChars) || "download";
        const dot = clean.lastIndexOf(".");
        const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
        const dir = path.join(this.root, "Downloads");
        for (let n = 0; n < 1000; n++) {
            const name = n ? `${stem} (${n})${ext}` : clean;
            if (!fs.existsSync(path.join(dir, name))) return path.join(dir, name);
        }
        throw new Error("too many downloads share that name");
    }
}


/**
 * The home folder used to be inside the browser's folder (`from`); it's its
 * own now (`to`), beside it. Moved once, whole. If both exist (an older version ran
 * after the move), the older one goes inside the new one as "Earlier home
 * folder", so nothing in either is lost or overwritten.
 */
export function moveHomeFolder(from: string, to: string): void {
    if (!fs.existsSync(from)) return;
    if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        return;
    }
    for (let n = 0; n < 1000; n++) {
        const into = path.join(to, n ? `Earlier home folder (${n})` : "Earlier home folder");
        if (fs.existsSync(into)) continue;
        fs.renameSync(from, into);
        console.warn(`[ai] two home folders: the one from ${from} is now ${into}`);
        return;
    }
    throw new Error(`the old home folder at ${from} couldn't be moved into ${to}: too many earlier ones`);
}
