// What the Blocks panel is told as the agent changes: the values it watches
// (each told only when it reads differently from the last time) and the events
// flows start from. Nothing is told before the blocks are registered.

import { type BlocksHandle, errorMessage, problemsApi } from "@mileniumhq/paperapi";
import { PANEL_ID, type MemoryList } from "../contract";

export interface BlocksSyncDeps {
    blocks: BlocksHandle;
    /** the values Blocks is told about when they change, read as Blocks compares them */
    watched(): Record<string, () => unknown>;
    memory(): Promise<MemoryList>;
}

export class BlocksSync {
    private registered = false;
    /** each value as Blocks was last told it was */
    private readonly announced = new Map<string, string>();
    /** the memory revision Blocks was last told about */
    private memoryRevision = 0;

    constructor(private deps: BlocksSyncDeps) {}

    /** Register the blocks, and take each value as Blocks reads it now. */
    async register(defs: Parameters<BlocksHandle["register"]>[0]) {
        await this.deps.blocks.register(defs);
        for (const [value, read] of Object.entries(this.deps.watched())) {
            try {
                this.announced.set(value, JSON.stringify(read()));
            } catch (e) {
                // quiet: unreadable now (broken routines, say): the first change it reads after is announced
                console.error(`[agents] ${value} can't be read for Blocks:`, String(e));
            }
        }
        await this.deps.memory().then(
            (list) => this.seeMemory(list, false),
            // quiet: an unreadable memory shows in state.memory.error; its next change is announced
            (e) => console.error("[agents] memory can't be read for Blocks:", String(e)),
        );
        this.registered = true;
    }

    /** Tell Blocks a value changed, when it has since Blocks was last told. */
    announce(value: string) {
        if (!this.registered) return;
        let next: string;
        try {
            next = JSON.stringify(this.deps.watched()[value]!());
        } catch (e) {
            // quiet: the value is announced on its next readable change
            console.error(`[agents] ${value} can't be read for Blocks:`, String(e));
            return;
        }
        this.changedTo(value, next, true);
    }

    /** Memory is read on its own queue: what changed is worked out once the read is done. */
    memoryChanged(revision: number) {
        if (revision === this.memoryRevision || !this.registered) return;
        this.memoryRevision = revision;
        this.deps.memory().then(
            (list) => this.seeMemory(list, true),
            // quiet: an unreadable memory shows in state.memory.error; its next change is announced
            (e) => console.error("[agents] memory can't be read for Blocks:", String(e)),
        );
    }

    /** An event for the Blocks panel; nothing listens before the blocks are registered. */
    fire(event: string, payload: Record<string, unknown>) {
        if (!this.registered) return;
        // no user action waits on it: one that fails is the panel's problem
        this.deps.blocks.fire(event, payload).catch((e) => {
            const title = `Blocks didn't hear ${event}`;
            problemsApi.report(PANEL_ID, { key: title, title, message: errorMessage(e) });
        });
    }

    private seeMemory(list: MemoryList, tell: boolean) {
        this.changedTo("facts", JSON.stringify(list.facts.map((f) => f.id)), tell);
        this.changedTo("notes", JSON.stringify(list.notes.map((n) => n.key)), tell);
    }

    private changedTo(value: string, next: string, tell: boolean) {
        if (this.announced.get(value) === next) return;
        this.announced.set(value, next);
        if (!tell) return;
        this.deps.blocks.changed(value).catch((e) => {
            // not told, so not announced: the next change to it tells Blocks again
            if (this.announced.get(value) === next) this.announced.delete(value);
            console.error(`[agents] the change to ${value} didn't reach Blocks:`, errorMessage(e));
        });
    }
}
