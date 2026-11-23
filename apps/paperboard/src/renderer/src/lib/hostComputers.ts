// The computer list starts as a placeholder holding This Computer (see
// useComputers), so the desktop's rail draws before the host answers. A host
// without This Computer can't use that placeholder: its rail and Home wait
// for the real list, and it shows its empty state when the list is empty.

/** whether the shell shows the host's empty state instead of the rail and Home */
export function showsNoComputers(hostHasEmptyState: boolean, listLoaded: boolean, count: number): boolean {
    return hostHasEmptyState && (!listLoaded || count === 0);
}

/** the computer to show once one is removed: This Computer, else the first
 * one left; undefined when none are left */
export function computerAfterRemoval<T extends { id: string; isLocal?: boolean }>(remaining: T[]): T | undefined {
    return remaining.find((c) => c.isLocal) ?? remaining[0];
}
