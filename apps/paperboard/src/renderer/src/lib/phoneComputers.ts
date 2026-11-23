// The desktop app's phone mock (`paperboard --mobile`) runs no panels of its
// own: the computer it runs on (This Computer) is the desktop's, so it lists
// only paired computers, and with none it opens on the welcome page instead
// of Home (main.tsx).

interface ListedComputer {
    isLocal?: boolean;
}

/** the computers the shell lists: every one, or only the paired ones */
export function shownComputers<T extends ListedComputer>(computers: T[], hidesThisComputer: boolean): T[] {
    return hidesThisComputer ? computers.filter((c) => !c.isLocal) : computers;
}

/**
 * Every computer's id in its new order, after the shown ones were dragged
 * into `shownOrder`: a computer the phone hides keeps its place.
 */
export function orderWithShown(allIds: string[], shownOrder: string[]): string[] {
    const shown = new Set(shownOrder);
    const next = [...shownOrder];
    return allIds.map((id) => (shown.has(id) ? next.shift()! : id));
}
