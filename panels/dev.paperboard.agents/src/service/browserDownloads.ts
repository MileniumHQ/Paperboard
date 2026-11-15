// What the browser downloads: each file lands in the computer's own
// downloading folder under the browser's id for it, and moves to the agent's
// home folder (Downloads) once it's complete. A few at once, each under a size
// limit; what happens to each is a note for the agent.

import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "@mileniumhq/paperapi";
import type { Cdp } from "./cdp";
import type { HomeFolder } from "./homeFolder";

const MAX_DOWNLOADS = 8;
const DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface DownloadsDeps {
    home: HomeFolder;
    /** where the browser writes a download until it's complete */
    dir: string;
    note(text: string): void;
}

export class Downloads {
    /** the downloads going now, by the browser's id: the name each is kept as */
    private going = new Map<string, string>();

    constructor(private deps: DownloadsDeps) {}

    get dir() {
        return this.deps.dir;
    }

    /** An empty downloading folder for a browser starting now. */
    prepare() {
        fs.rmSync(this.deps.dir, { recursive: true, force: true });
        fs.mkdirSync(this.deps.dir, { recursive: true });
    }

    clear() {
        this.going.clear();
    }

    listen(cdp: Cdp) {
        cdp.on("Browser.downloadWillBegin", (p) => {
            if (this.going.size >= MAX_DOWNLOADS) {
                void cdp.send("Browser.cancelDownload", { guid: p.guid }).then(
                    () => this.deps.note(`A download of ${String(p.suggestedFilename)} was refused: ${MAX_DOWNLOADS} are already going.`),
                    (e) => this.deps.note(`A download of ${String(p.suggestedFilename)} is past the limit of ${MAX_DOWNLOADS} at once and couldn't be stopped: ${errorMessage(e)}`),
                );
                return;
            }
            this.going.set(p.guid, String(p.suggestedFilename || "download"));
        });
        cdp.on("Browser.downloadProgress", (p) => this.progress(cdp, p));
    }

    private progress(cdp: Cdp, p: any) {
        const name = this.going.get(p.guid);
        if (name === undefined) return;
        const temp = path.join(this.deps.dir, String(p.guid));
        if (p.state === "inProgress" && (p.receivedBytes > DOWNLOAD_MAX_BYTES || p.totalBytes > DOWNLOAD_MAX_BYTES)) {
            this.going.delete(p.guid);
            const limit = `${DOWNLOAD_MAX_BYTES / 1024 / 1024 / 1024} GB`;
            void cdp.send("Browser.cancelDownload", { guid: p.guid }).then(
                () => {
                    fs.rmSync(temp, { force: true });
                    this.deps.note(`The download of ${name} was stopped: it's bigger than ${limit}.`);
                },
                (e) => this.deps.note(`The download of ${name} is bigger than ${limit} and couldn't be stopped: ${errorMessage(e)}`),
            );
            return;
        }
        if (p.state === "completed") {
            this.going.delete(p.guid);
            try {
                const to = this.deps.home.downloadName(name);
                fs.renameSync(temp, to);
                this.deps.note(`Downloaded ${name} to ${this.deps.home.shown(to)}.`);
            } catch (e) {
                fs.rmSync(temp, { force: true });
                this.deps.note(`The download of ${name} finished but couldn't be kept: ${errorMessage(e)}`);
            }
        } else if (p.state === "canceled") {
            this.going.delete(p.guid);
            fs.rmSync(temp, { force: true });
            this.deps.note(`The download of ${name} didn't finish.`);
        }
    }
}
