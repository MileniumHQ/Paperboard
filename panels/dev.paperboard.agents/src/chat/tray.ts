// The files waiting to go with the next message: each uploads as soon as
// it's picked, pasted or dropped, shows its progress, and can be taken off
// (which stops its upload). Sending takes the finished ones off.

import { onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { LIMITS, type Attachment } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText } from "../lib/failure";

export interface Chip {
    key: string;
    name: string;
    /** a local picture of an image or video being sent, while it's here */
    preview: string | null;
    kind: "image" | "video" | "audio" | "file";
    /** 0–1 while uploading */
    progress: number;
    file: Attachment | null;
    error: string | null;
}

const kindOf = (type: string): Chip["kind"] =>
    type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : "file";

let keys = 0;

export function createTray(agent: Agent) {
    // a store: a chip's progress changes the chip in place, so its row stays the row it was
    const [list, setChips] = createStore<Chip[]>([]);
    const chips = () => list;
    const aborts = new Map<string, AbortController>();
    const update = (key: string, change: Partial<Chip>) => setChips((c) => c.key === key, change);

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
                setChips(list.length, { key, name: f.name, preview: kind === "image" || kind === "video" ? URL.createObjectURL(f) : null, kind, progress: 0, file: null, error: null });
                agent.files
                    .upload(f, (progress) => update(key, { progress }), abort.signal)
                    .then(
                        (file) => update(key, { file, progress: 1 }),
                        (e) => !abort.signal.aborted && update(key, { error: errorText(e) }),
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
        uploading: () => chips().some((c) => !c.file && !c.error),
        failed: () => chips().some((c) => c.error),
        /** the uploaded files, by chip: what a message takes, and what is taken off once it has gone */
        sendable: () => chips().flatMap((c) => (c.file ? [{ key: c.key, id: c.file.id }] : [])),
        clear() {
            for (const c of chips()) release(c);
            setChips([]);
        },
    };
    onCleanup(tray.clear);
    return tray;
}

export type Tray = ReturnType<typeof createTray>;
