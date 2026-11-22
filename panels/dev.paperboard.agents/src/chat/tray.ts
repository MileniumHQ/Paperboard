// The files waiting to go with the next message: each uploads as soon as
// it's picked, pasted or dropped, shows its progress, and can be taken off
// (which stops its upload). Sending takes the finished ones off.

import { onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { errorMessage } from "@mileniumhq/paperapi";
import { LIMITS, type Attachment } from "../contract";
import type { Agent } from "../lib/agent";

export interface Chip {
    key: string;
    name: string;
    /** the file on this device, while it's here: what its thumbnail is made of */
    url: string;
    type: string;
    /** 0–1 while uploading */
    progress: number;
    file: Attachment | null;
    error: string | null;
}

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
        URL.revokeObjectURL(c.url);
    };

    const tray = {
        chips,
        /** Files picked, pasted or dropped: past the per-message limit, the rest are refused with a note. */
        add(files: File[]): string | null {
            const room = LIMITS.attachments.perMessage - chips().length;
            for (const f of files.slice(0, Math.max(0, room))) {
                const key = `chip${++keys}`;
                const abort = new AbortController();
                aborts.set(key, abort);
                setChips(list.length, { key, name: f.name, url: URL.createObjectURL(f), type: f.type, progress: 0, file: null, error: null });
                agent.files
                    .upload(f, (progress) => update(key, { progress }), abort.signal)
                    .then(
                        (file) => update(key, { file, progress: 1 }),
                        (e) => !abort.signal.aborted && update(key, { error: errorMessage(e) }),
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
