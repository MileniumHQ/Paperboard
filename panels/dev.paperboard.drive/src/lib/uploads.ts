// The uploads the page is sending: files from the computer, a couple at a
// time, each into the folder it was dropped on, with how far they've got.
import { batch, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { DriveEntry } from "./contract";
import type { DriveFiles } from "./files";

const AT_ONCE = 2;

export interface UploadJob {
    id: number;
    name: string;
    folder: string;
    size: number;
    sent: number;
}

interface Waiting extends UploadJob {
    file: File;
    controller: AbortController;
}

export interface UploadHandlers {
    landed: (entry: DriveEntry) => void;
    failed: (name: string, err: unknown) => void;
    /** every file sent, or canceled: how many landed */
    finished: (landed: number) => void;
}

export function createUploads(files: DriveFiles, on: UploadHandlers) {
    const [jobs, setJobs] = createStore<UploadJob[]>([]);
    const [canceled, setCanceled] = createSignal(false);
    const queue: Waiting[] = [];
    const running = new Map<number, Waiting>();
    let nextId = 0;
    let landed = 0;

    const remove = (id: number) => setJobs((all) => all.filter((j) => j.id !== id));

    function pump() {
        while (running.size < AT_ONCE && queue.length) {
            const job = queue.shift()!;
            running.set(job.id, job);
            void files
                .upload(job.file, job.folder, (sent) => setJobs((j) => j.id === job.id, "sent", sent), job.controller.signal)
                .then(
                    (entry) => {
                        landed++;
                        on.landed(entry);
                    },
                    (err: unknown) => {
                        if (!job.controller.signal.aborted) on.failed(job.name, err);
                    },
                )
                .finally(() => {
                    running.delete(job.id);
                    remove(job.id);
                    pump();
                });
        }
        if (running.size === 0 && queue.length === 0 && jobs.length === 0) {
            const count = landed;
            landed = 0;
            const wasCanceled = canceled();
            setCanceled(false);
            if (count > 0 || !wasCanceled) on.finished(count);
        }
    }

    return {
        /** what's being sent and what waits, in order */
        jobs: () => jobs,
        add(list: File[], folder: string) {
            if (!list.length) return;
            const added = list.map((file): Waiting => ({ id: ++nextId, name: file.name, folder, size: file.size, sent: 0, file, controller: new AbortController() }));
            batch(() => {
                setJobs(produce((all) => all.push(...added.map(({ id, name, folder: f, size, sent }) => ({ id, name, folder: f, size, sent })))));
                queue.push(...added);
            });
            pump();
        },
        /** stops every upload, and drops the ones waiting */
        cancel() {
            setCanceled(true);
            for (const job of queue.splice(0)) remove(job.id);
            for (const job of running.values()) job.controller.abort();
            pump();
        },
    };
}
