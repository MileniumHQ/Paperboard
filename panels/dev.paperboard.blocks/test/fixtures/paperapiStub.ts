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
        entry: "event.joined",
        schema: { kind: "event", id: "joined", name: "Someone Joined", values: { who: { type: "text", name: "Who" } } },
    },
] as BlockInfo[];

/** Every save the editor made, oldest first. */
export const saves: SavedFlows[] = [];

export const blocksApi = {
    list: async (): Promise<BlockInfo[]> => structuredClone(ENTRIES),
    projects: async (): Promise<BlockProjectInfo[]> => [],
    choices: async (panelId: string, entry: string, input: string): Promise<never> => {
        throw new Error(`the fixture has no choices for ${panelId} ${entry} ${input}`);
    },
    typeChoices: async (typeRef: string): Promise<never> => {
        throw new Error(`the fixture has no choices for ${typeRef}`);
    },
    onRegistryChange: (): (() => void) => () => {},
};

export const panelsApi = {
    list: async (): Promise<PanelItem[]> => [{ id: FIXTURE_PANEL, name: FIXTURE_PANEL_NAME } as PanelItem],
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
