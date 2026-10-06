// Browser-only transport fixture. The real wire is covered by the daemon's
// actionMultiplicity test; this fixture checks the editor's visible outcome.
export * from "../../../../packages/paperapi/dist/paperapi.es.js";

export const fixture = {
    failApply: true,
    failLoad: new URLSearchParams(location.search).has("fail-load"),
    saved: null as any,
    calls: [] as string[],
    registry: new Set<() => void>(),
    initial: {
        flows: [{ id: "first", panelId: "builtin.logic", pos: { x: 100, y: 100 }, isTrigger: true,
            action: { id: "on-play", name: "On Play" }, values: {}, children: [] }],
        notes: [{ id: "saved-note", pos: { x: 500, y: 100 }, text: "Keep this note" }],
        functions: [],
    },
};

export const config = {
    get: async () => {
        if (fixture.failLoad) throw new Error("document unavailable");
        return structuredClone(fixture.initial);
    },
    set: async (data: any) => {
        fixture.calls.push("save");
        fixture.saved = structuredClone(data);
    },
};
export const actions = {
    list: async () => [],
    onRegistryChange: (callback: () => void) => {
        fixture.registry.add(callback);
        return () => { fixture.registry.delete(callback); };
    },
    onTrigger: () => () => undefined,
    call: async (_panelId: string, action: string) => {
        fixture.calls.push(action);
        if (action === "sync-flows" && fixture.failApply) throw new Error("service unavailable");
        return { status: "success" };
    },
};
export const panels = { list: async () => [] };
