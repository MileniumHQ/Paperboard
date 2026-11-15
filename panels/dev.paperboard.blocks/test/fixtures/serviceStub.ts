// The SDK as the browser fixtures see it: everything real except what needs
// a daemon. The registry lists one panel's blocks, and the service client behaves as
// the real one does over the wire. The service's state lives in this page;
// `service.announce` sends a patch of it the way the daemon delivers one
// (parsed from JSON: every object in it is new), and the client hands its
// listeners the merged state and that patch, exactly as serviceClient's
// state does. Calls answer from that state, or from the real service once it is
// told to serve them, and a call can be told to fail. Every
// answer comes a task later, as one over the wire does.
// first: the contract the page imports is made with the real SDK
export * from "../../../../packages/paperapi/dist/paperapi.es.js";
import type { BlockInfo, BlockProjectInfo, PanelItem } from "@mileniumhq/paperapi";
import type { ProjectSummary } from "../../src/panel";
import { blocksContract, type PanelState, type SavedFlows } from "../../src/panel";


export const FIXTURE_PANEL = "dev.test.fixture";
export const FIXTURE_PANEL_NAME = "Fixture Panel";

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

let confirmLeave: (() => Promise<boolean>) | null = null;
/** what the page told Paperboard of its unsaved work, as the shell keeps it */
export const unsaved = {
    /** what Paperboard calls before it restarts or uninstalls the panel, while the page holds unsaved work */
    confirm: () => confirmLeave,
};
export function setUnsavedChanges(confirm: (() => Promise<boolean>) | null): void {
    confirmLeave = confirm;
}

export const SERVICED_PROJECT = "p-serviced";

export const project = (id: string, name: string, editedAt = 0): ProjectSummary => ({
    id,
    name,
    enabled: true,
    createdAt: 0,
    editedAt,
    preview: null,
    draft: false,
    loadError: null,
    flowCount: 0,
});

type Listener = (full: PanelState, patch: Partial<PanelState>) => void;
const listeners = new Set<Listener>();
let shared: PanelState = { ...blocksContract.state.initial, loaded: true, projects: [project(SERVICED_PROJECT, "Serviced project")] };
const failing = new Map<CallName, string>();
const flows = new Map<string, SavedFlows>();
const calls: { name: CallName; input: unknown }[] = [];
let projectsMade = 0;
let served: Record<string, (input: any) => unknown> | null = null;

export const service = {
    /** what the service announces next, as the daemon delivers it */
    announce(patch: Partial<PanelState>): void {
        const delivered = JSON.parse(JSON.stringify(patch)) as Partial<PanelState>;
        shared = { ...shared, ...delivered };
        for (const listener of [...listeners]) listener(shared, delivered);
    },
    state: (): PanelState => shared,
    /** every call the page made, oldest first */
    calls: (): { name: CallName; input: any }[] => calls,
    /** from now on the calls are answered by these, the real service's (src/runtime.ts) */
    serve(handlers: Record<string, (input: any) => unknown>): void {
        served = handlers;
    },
    /** the service's call `name` fails with `reason` until told otherwise (null) */
    fail(name: CallName, reason: string | null): void {
        if (reason === null) failing.delete(name);
        else failing.set(name, reason);
    },
};

type CallName = keyof typeof blocksContract.calls;
type Input = { project?: string; flows?: SavedFlows; name?: string; enabled?: boolean; onlyDraft?: boolean };

async function answer(name: CallName, input: Input): Promise<unknown> {
    calls.push({ name, input: structuredClone(input) });
    // the service answers over the wire, never within the call
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reason = failing.get(name);
    if (reason) throw new Error(reason);
    if (served) return structuredClone(await served[name]!(structuredClone(input)));
    if (name === "loadFlows") return structuredClone(flows.get(input.project!) ?? { workspace: {}, schemas: {} });
    if (name === "saveFlows") {
        flows.set(input.project!, structuredClone(input.flows!));
        return shared.projects.find((p) => p.id === input.project);
    }
    if (name === "updateProject") {
        const projects = shared.projects.map((p) => (p.id === input.project ? { ...p, ...(input.name ? { name: input.name } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) } : p));
        service.announce({ projects });
        return projects.find((p) => p.id === input.project);
    }
    if (name === "createProject") {
        const made = { ...project(`p-new-${++projectsMade}`, "Untitled project", Date.now()), draft: true };
        service.announce({ projects: [...shared.projects, made] });
        return made;
    }
    if (name === "deleteProject") {
        // as the service does: a draft that has a block by now is kept
        const kept = input.onlyDraft && Boolean(flows.get(input.project!)?.workspace.blocks?.blocks.length);
        if (kept) return { deleted: false };
        service.announce({ projects: shared.projects.filter((p) => p.id !== input.project) });
        return { deleted: true };
    }
    throw new Error(`the fixture's service has no call "${name}"`);
}

/** The page's client, answering from the state above as the service would. */
export function serviceClient(contract: typeof blocksContract) {
    const calls = Object.fromEntries(Object.keys(contract.calls).map((name) => [name, (input: Input = {}) => answer(name as CallName, input)]));
    return {
        panelId: contract.panelId,
        calls,
        events: {},
        state: {
            current: () => shared,
            refresh: async () => {
                const fetched = JSON.parse(JSON.stringify(shared)) as PanelState;
                shared = { ...shared, ...fetched };
                for (const listener of [...listeners]) listener(shared, fetched);
                return shared;
            },
            subscribe: (listener: Listener): (() => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            error: () => null,
            dispose: () => listeners.clear(),
        },
    };
}
