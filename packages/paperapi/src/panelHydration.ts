// Document-local bridge owners participate in the shell's readiness
// challenge. Hydrating a throwaway snapshot is not hydrating the UI.
const hydrators = new Set<{ panelId: string; hydrate: () => Promise<unknown> }>();

export function registerPanelHydrator(panelId: string, hydrate: () => Promise<unknown>): () => void {
    if (hydrators.size >= 128) throw new Error("Too many panel bridges; dispose unused bridges");
    const owner = { panelId, hydrate };
    hydrators.add(owner);
    return () => { hydrators.delete(owner); };
}

export async function hydratePanelBridges(panelId: string): Promise<void> {
    for (const owner of hydrators) {
        if (owner.panelId === panelId) await owner.hydrate();
    }
}
