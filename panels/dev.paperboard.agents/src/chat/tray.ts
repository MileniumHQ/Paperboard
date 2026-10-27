// The files waiting to go with the next message: each uploads as soon as
// it's picked, pasted or dropped, shows its progress, and can be taken off
// (which stops its upload). Sending takes the finished ones; a message
// taken back puts its files back here.

import { createSignal, onCleanup } from "solid-js";
import { LIMITS, type Attachment } from "../contract";
import type { Agent } from "../lib/agent";

export interface Chip {
    key: string;
    name: string;
    /** a local picture of an image or video being sent, while it's here */
    preview: string | null;
    kind: "image" | "video" | "file";
    /** 0–1 while uploading */
    progress: number;
    file: Attachment | null;
    error: string | null;
}

const kindOf = (type: string): Chip["kind"] => (type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file");

let keys = 0;

export function createTray(agent: Agent) {
    const [chips, setChips] = createSignal<Chip[]>([]);
    const aborts = new Map<string, AbortController>();
    const update = (key: string, change: Partial<Chip>) => setChips((cs) => cs.map((c) => (c.key === key ? { ...c, ...change } : c)));

    const release = (c: Chip) => {
        aborts.get(c.key)?.abort();
        aborts.delete(c.key);
        if (c.preview) URL.revokeObjectURL(c.preview);
    };

    const tray = {
        chips,
        /** Files picked, pasted or dropped: past the per-message limit, the rest are refused with a note. */
        add(files: File[]): string | null {
            const room = LIMITS.attachments.perMessage - chips().length;
            for (const f of files.slice(0, Math.max(0, room))) {
                const key = `chip${++keys}`;
                const kind = kindOf(f.type);
                const abort = new AbortController();
                aborts.set(key, abort);
                setChips((cs) => [...cs, { key, name: f.name, preview: kind === "file" ? null : URL.createObjectURL(f), kind, progress: 0, file: null, error: null }]);
                agent.files
                    .upload(f, (progress) => update(key, { progress }), abort.signal)
                    .then(
                        (file) => update(key, { file, progress: 1 }),
                        (e) => !abort.signal.aborted && update(key, { error: e instanceof Error ? e.message : String(e) }),
                    )
                    .finally(() => aborts.delete(key));
            }
            return files.length > room ? `A message can carry ${LIMITS.attachments.perMessage} files.` : null;
        },
        remove(key: string) {
            const c = chips().find((x) => x.key === key);
            if (c) release(c);
            setChips((cs) => cs.filter((x) => x.key !== key));
        },
        /** A message's files back in the tray, already uploaded. */
        restore(files: Attachment[]) {
            setChips((cs) => [...cs, ...files.map((file) => ({ key: `chip${++keys}`, name: file.name, preview: null, kind: file.kind, progress: 1, file, error: null }))]);
        },
        uploading: () => chips().some((c) => !c.file && !c.error),
        failed: () => chips().some((c) => c.error),
        ids: () => chips().flatMap((c) => (c.file ? [c.file.id] : [])),
        clear() {
            for (const c of chips()) release(c);
            setChips([]);
        },
    };
    onCleanup(tray.clear);
    return tray;
}

export type Tray = ReturnType<typeof createTray>;
