// The SDK as the editor fixture sees it: everything real except the three
// things that need a daemon. The registry lists one panel's blocks, and the
// bridge is a service that keeps one project's flows in memory, so the
// fixture reads back exactly what the editor saved.
import type { BlockInfo, BlockProjectInfo, PanelItem } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, SERVICE_CALLS, type PanelState, type SavedFlows } from "../../src/panel";

export * from "../../../../packages/paperapi/dist/paperapi.es.js";

export const FIXTURE_PANEL = "dev.test.fixture";
export const FIXTURE_PANEL_NAME = "Fixture Panel";
export const FIXTURE_PROJECT = "p-fixture";

const ENTRIES = [
    {
        panelId: FIXTURE_PANEL,
        entry: "command.greet",
        schema: { kind: "command", id: "greet", name: "Greet", text: "Greet {who}", inputs: { who: { type: "text", name: "Who" } } },
    },
    {
        panelId: FIXTURE_PANEL,
        entry: "command.count",
        schema: { kind: "command", id: "count", name: "Count Players", text: "Count players", output: "number", outputName: "Players" },
    },
    {
        panelId: FIXTURE_PANEL,
        entry: "event.joined",
        schema: { kind: "event", id: "joined", name: "Someone Joined", values: { who: { type: "text", name: "Who" } } },
    },
] as BlockInfo[];

/** Every save the editor made, oldest first. */
export const saves: SavedFlows[] = [];

let entries = structuredClone(ENTRIES);
let panels: PanelItem[] = [{ id: FIXTURE_PANEL, name: FIXTURE_PANEL_NAME } as PanelItem];
const registryListeners = new Set<(change: unknown) => void>();
let held: Promise<void> | null = null;

/** The registry as other panels change it. */
export const registry = {
    /** the next listing is of the registry as it is now, but answers only once released */
    hold(): () => void {
        let release!: () => void;
        held = new Promise((resolve) => (release = resolve));
        return release;
    },
    /** a panel starts offering a block */
    offer(panel: PanelItem, entry: BlockInfo): void {
        panels = [...panels, panel];
        entries = [...entries, entry];
    },
    /** tells every listener the registry changed */
    changed(): void {
        for (const listener of [...registryListeners]) listener(null);
    },
};

export const blocksApi = {
    list: async (): Promise<BlockInfo[]> => {
        const answer = structuredClone(entries);
        const wait = held;
        held = null;
        if (wait) await wait;
        return answer;
    },
    projects: async (): Promise<BlockProjectInfo[]> => [],
    choices: async (panelId: string, entry: string, input: string): Promise<never> => {
        throw new Error(`the fixture has no choices for ${panelId} ${entry} ${input}`);
    },
    typeChoices: async (typeRef: string): Promise<never> => {
        throw new Error(`the fixture has no choices for ${typeRef}`);
    },
    onRegistryChange: (listener: (change: unknown) => void): (() => void) => {
        registryListeners.add(listener);
        return () => registryListeners.delete(listener);
    },
};

export const panelsApi = {
    list: async (): Promise<PanelItem[]> => structuredClone(panels),
};

export function createPanelBridge() {
    const state: PanelState = {
        ...DEFAULT_STATE,
        loaded: true,
        projects: [{ id: FIXTURE_PROJECT, name: "Fixture project", enabled: true, createdAt: 0, editedAt: 0, preview: null, draft: false, loadError: null, flowCount: 0 }],
    };
    return {
        getState: () => state,
        refreshState: async () => state,
        onStateChange: (): (() => void) => () => {},
        call: async (name: string, input: { flows?: SavedFlows } = {}): Promise<unknown> => {
            if (name === SERVICE_CALLS.load) return structuredClone(saves.at(-1) ?? { workspace: {}, schemas: {} });
            if (name === SERVICE_CALLS.save) {
                saves.push(structuredClone(input.flows!));
                return null;
            }
            throw new Error(`the fixture's service has no call "${name}"`);
        },
    };
}
