// Browser-only transport fixture. The real wire is covered by the daemon's
// actionMultiplicity test; this fixture checks the editor's visible outcome.
export * from "../../../../packages/paperapi/dist/paperapi.es.js";

export const fixture = {
    failApply: true,
    failLoad: new URLSearchParams(location.search).has("fail-load"),
    saved: null as any,
    revision: 0,
    calls: [] as string[],
    registry: new Set<() => void>(),
    // canvas-changed listeners: the fixture plays the other window
    changed: new Set<(change: any) => void>(),
    initial: {
        flows: [{ id: "first", panelId: "builtin.logic", pos: { x: 100, y: 100 }, isTrigger: true,
            action: { id: "on-play", name: "On Play" }, values: {}, children: [] }],
        notes: [{ id: "saved-note", pos: { x: 500, y: 100 }, text: "Keep this note" }],
        functions: [],
    },
};

// the editor saves and loads through the service, never config directly
export const config = {
    get: async () => {
        throw new Error("the editor must load the canvas through get-canvas");
    },
    set: async () => {
        throw new Error("the editor must save the canvas through save-canvas");
    },
};
export const actions = {
    list: async () => [],
    onRegistryChange: (callback: () => void) => {
        fixture.registry.add(callback);
        return () => { fixture.registry.delete(callback); };
    },
    onTrigger: () => () => undefined,
    on: (_panelId: string, event: string, callback: (change: any) => void) => {
        if (event !== "canvas-changed") return () => undefined;
        fixture.changed.add(callback);
        return () => { fixture.changed.delete(callback); };
    },
    call: async (_panelId: string, action: string, inputs: any) => {
        if (action === "get-canvas") {
            if (fixture.failLoad) throw new Error("document unavailable");
            return { revision: fixture.revision, canvas: structuredClone(fixture.saved ?? fixture.initial) };
        }
        fixture.calls.push(action);
        if (action === "save-canvas") {
            if (inputs.baseRevision !== fixture.revision) {
                throw new Error(`canvas-conflict: the canvas changed in another window (now revision ${fixture.revision})`);
            }
            fixture.saved = structuredClone(inputs.canvas);
            fixture.revision += 1;
            return fixture.failApply
                ? { revision: fixture.revision, applyError: "service unavailable" }
                : { revision: fixture.revision };
        }
        return { status: "success" };
    },
};
export const panels = { list: async () => [] };
