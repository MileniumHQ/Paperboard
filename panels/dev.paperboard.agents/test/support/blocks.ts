// The Blocks registry as the service's handle meets it, kept in memory:
// PaperAPI's memoryBlocks, which checks what the service registers, runs,
// fires and changes the way the daemon's registry does.

import { memoryBlocks, type BlockKind, type BlockSet, type BlocksHandle } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../../src/contract";
import { Recorder } from "./host";

export class TestBlocks implements BlocksHandle {
    readonly panelId = PANEL_ID;
    set: BlockSet | null = null;
    readonly fired = new Recorder<{ event: string; payload: Record<string, unknown> }>();
    readonly changes = new Recorder<string>();
    private readonly memory = memoryBlocks(PANEL_ID, {
        fired: (event, payload) => this.fired.push({ event, payload }),
        changed: (value) => this.changes.push(value),
    });

    async register(set: BlockSet): Promise<void> {
        await this.memory.panel.register(set);
        this.set = set;
    }

    async unregister(kind: BlockKind, id: string): Promise<void> {
        throw new Error(`the service never unregisters blocks (${kind}.${id})`);
    }

    fire(event: string, payload: Record<string, unknown>): Promise<void> {
        return this.memory.panel.fire(event, payload);
    }

    changed(value: string): Promise<void> {
        return this.memory.panel.changed(value);
    }

    run<T = unknown>(id: string, inputs: Record<string, unknown> = {}): Promise<T> {
        return this.memory.run<T>(id, inputs);
    }

    read<T = unknown>(id: string, inputs: Record<string, unknown> = {}): Promise<T> {
        return this.memory.read<T>(id, inputs);
    }

    property<T = unknown>(type: string, field: string, value: unknown): Promise<T> {
        return this.memory.property<T>(type, field, value);
    }
}
