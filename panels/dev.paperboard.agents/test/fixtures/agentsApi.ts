// Browser-only stand-in for the Agents service, behind the two paperapi
// calls the UI makes (actionsApi and createPanelBridge). The service's own
// answers are covered by its suites; this lets a fixture drive the real UI
// into the service's refusals and read what the person is shown.
import { DEFAULT_STATE, UI_ACTION_IDS, type AiState, type AppInfo, type ChatEntry, type Routine } from "../../src/contract";
import { TOOLS_ACTION_IDS, type ToolsView } from "../../src/toolsContract";

export const service = {
    state: {
        ...structuredClone(DEFAULT_STATE),
        settings: { name: "Pip", harness: "codex", model: null, compaction: "summarize" },
        computer: { phase: "ready", installed: true, steps: [], error: null, userControl: false },
    } as AiState,
    /** action id → the message it's refused with */
    refuse: {} as Record<string, string>,
    calls: [] as string[],
    routines: [] as Routine[],
    history: [] as ChatEntry[],
    apps: [] as AppInfo[],
    /** each app's own address, as the service gives it */
    appUrl: (name: string) => `about:blank#${name}`,
    tools: {
        config: { actions: false, servers: [{ name: "notes", where: "host", enabled: true, transport: "stdio", command: "notes-mcp", args: [], env: {} }] },
        status: [{ name: "notes", phase: "running", error: null, tools: 3 }],
        secrets: {},
        configError: null,
    } as unknown as ToolsView,
};

const answers: Record<string, () => unknown> = {
    [UI_ACTION_IDS.history]: () => service.history,
    [UI_ACTION_IDS.providers]: () => ({ providers: [] }),
    [UI_ACTION_IDS.models]: () => ({ models: [] }),
    [UI_ACTION_IDS.windows]: () => ({ windows: [] }),
    [UI_ACTION_IDS.routines]: () => service.routines,
    [UI_ACTION_IDS.memory]: () => ({ facts: [], notes: [] }),
    [UI_ACTION_IDS.apps]: () => service.apps,
    [UI_ACTION_IDS.conversations]: () => ({
        current: { id: "current", title: "hi", startedAt: 0, endedAt: 0, messages: 1 },
        past: [{ id: "0123456789ab", title: "plan my trip to Oslo", startedAt: 0, endedAt: 0, messages: 4 }],
    }),
    // a 1×1 picture
    [UI_ACTION_IDS.appPicture]: () => ({ image: "R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=" }),
    [TOOLS_ACTION_IDS.get]: () => service.tools,
    [TOOLS_ACTION_IDS.remove]: () => service.tools,
};

export const actionsApi = {
    on: () => () => undefined,
    call: async (_panel: string, id: string, input?: { name?: string }) => {
        service.calls.push(id);
        await Promise.resolve();
        if (service.refuse[id]) throw new Error(service.refuse[id]);
        if (id === UI_ACTION_IDS.openApp) return { url: service.appUrl(input!.name!), title: service.apps.find((a) => a.name === input!.name)!.title };
        if (id === UI_ACTION_IDS.deleteApp) service.apps = service.apps.filter((a) => a.name !== input!.name);
        if (id === TOOLS_ACTION_IDS.remove) service.tools.config.servers = service.tools.config.servers.filter((s) => s.name !== input!.name);
        return structuredClone(answers[id]?.() ?? {});
    },
};

/** the panel is on the computer it's shown on */
export const grantedComputerId = () => "local";

export function createPanelBridge() {
    return {
        onStateChange: () => () => undefined,
        refreshState: async () => structuredClone(service.state),
        dispose: () => undefined,
    };
}
