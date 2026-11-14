// The SDK as the panel fixture sees it: paperapiStub's registry, and a bridge
// that behaves as the real one does over the wire. The service's state lives
// in this page; `service.announce` sends a patch of it the way the daemon
// delivers one (parsed from JSON: every object in it is new), and the bridge
// hands its listeners that patch and the merged state, exactly as
// createPanelBridge does. Calls answer from that state, and a call can be
// told to fail. Every answer comes a task later, as one over the wire does.
import type { ProjectSummary } from "../../src/lib/projects";
import { DEFAULT_STATE, SERVICE_CALLS, type PanelState, type SavedFlows } from "../../src/panel";

export * from "./paperapiStub";

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

type Listener = (patch: Partial<PanelState>, full: PanelState) => void;
const listeners = new Set<Listener>();
let shared: PanelState = { ...DEFAULT_STATE, loaded: true, projects: [project(SERVICED_PROJECT, "Serviced project")] };
const failing = new Map<string, string>();
const flows = new Map<string, SavedFlows>();
const calls: { name: string; input: unknown }[] = [];
let projectsMade = 0;

export const service = {
    /** what the service announces next, as the daemon delivers it */
    announce(patch: Partial<PanelState>): void {
        const delivered = JSON.parse(JSON.stringify(patch)) as Partial<PanelState>;
        shared = { ...shared, ...delivered };
        for (const listener of [...listeners]) listener(delivered, shared);
    },
    state: (): PanelState => shared,
    /** every call the page made, oldest first */
    calls: (): { name: string; input: any }[] => calls,
    /** the service's call `name` fails with `reason` until told otherwise (null) */
    fail(name: string, reason: string | null): void {
        if (reason === null) failing.delete(name);
        else failing.set(name, reason);
    },
};

export function createPanelBridge() {
    return {
        getState: () => shared,
        refreshState: async () => {
            const fetched = JSON.parse(JSON.stringify(shared)) as PanelState;
            shared = { ...shared, ...fetched };
            for (const listener of [...listeners]) listener(fetched, shared);
            return shared;
        },
        onStateChange: (listener: Listener): (() => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        call: async (name: string, input: { project?: string; flows?: SavedFlows; name?: string; enabled?: boolean; onlyDraft?: boolean } = {}): Promise<unknown> => {
            calls.push({ name, input: structuredClone(input) });
            // the service answers over the wire, never within the call
            await new Promise((resolve) => setTimeout(resolve, 0));
            const reason = failing.get(name);
            if (reason) throw new Error(reason);
            if (name === SERVICE_CALLS.load) return structuredClone(flows.get(input.project!) ?? { workspace: {}, schemas: {} });
            if (name === SERVICE_CALLS.save) {
                flows.set(input.project!, structuredClone(input.flows!));
                return null;
            }
            if (name === SERVICE_CALLS.updateProject) {
                const projects = shared.projects.map((p) => (p.id === input.project ? { ...p, ...(input.name ? { name: input.name } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) } : p));
                service.announce({ projects });
                return projects.find((p) => p.id === input.project);
            }
            if (name === SERVICE_CALLS.createProject) {
                const made = { ...project(`p-new-${++projectsMade}`, "Untitled project", Date.now()), draft: true };
                service.announce({ projects: [...shared.projects, made] });
                return made;
            }
            if (name === SERVICE_CALLS.deleteProject) {
                // as the service does: a draft that has a block by now is kept
                const kept = input.onlyDraft && Boolean(flows.get(input.project!)?.workspace.blocks?.blocks.length);
                if (kept) return { deleted: false };
                service.announce({ projects: shared.projects.filter((p) => p.id !== input.project) });
                return { deleted: true };
            }
            throw new Error(`the fixture's service has no call "${name}"`);
        },
    };
}
