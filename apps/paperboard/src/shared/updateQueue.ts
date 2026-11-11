// The update queue the top bar shows: every update Paperboard is doing
// (itself, panels, runtime packages, Paperboard Server on paired
// computers), and the updates held back because something is using what
// they replace.

export type UpdateKind = "app" | "panel" | "package" | "server";

// held: downloaded or planned, but something is using what it replaces;
// it moves to the queue's holds
export type UpdateStatus = "queued" | "running" | "done" | "held" | "failed";

export type UpdateStage = "stopping" | "downloading" | "installing";

export interface UpdateItem {
    key: string;
    kind: UpdateKind;
    computerId: string;
    // null for this computer: the list names only other computers
    computerName: string | null;
    // the panel being replaced; it can't be opened while this runs
    panelId: string | null;
    name: string;
    version: string;
    status: UpdateStatus;
    stage: UpdateStage | null;
    // null while the size of the work is unknown
    percent: number | null;
    bytesLoaded: number | null;
    bytesTotal: number | null;
    error: string | null;
}

// an update that waits for what is using it to stop
export interface UpdateHold {
    key: string;
    kind: "panel" | "package";
    computerId: string;
    computerName: string | null;
    // the panel id or package name
    id: string;
    name: string;
    version: string;
    // panel releases: what the plan expects the daemon to install
    sha256: string | null;
    // display names of the panels using it ("Paperboard" for processes the
    // app started itself); for a panel, the panel itself
    users: string[];
}

export interface UpdateQueueState {
    revision: number;
    // looking for updates: registries and computers are being asked
    checking: boolean;
    items: UpdateItem[];
    holds: UpdateHold[];
    // why the last look for updates could not finish
    checkError: string | null;
}

export const initialUpdateQueueState: UpdateQueueState = {
    revision: 0,
    checking: false,
    items: [],
    holds: [],
    checkError: null,
};

/** Items still to do: what the top bar's count shows. */
export function pendingUpdates(state: UpdateQueueState): UpdateItem[] {
    return state.items.filter((item) => item.status === "queued" || item.status === "running");
}

/**
 * How far the batch in the list has come, 0 to 100: each item weighs the
 * same, a running one counts its own progress. null while the only thing
 * left has no measurable progress.
 */
export function batchPercent(state: UpdateQueueState): number | null {
    const items = state.items;
    if (items.length === 0) return null;
    let done = 0;
    let measurable = false;
    for (const item of items) {
        if (item.status === "queued") continue;
        if (item.status === "running") {
            if (item.percent !== null) {
                done += item.percent / 100;
                measurable = true;
            }
            continue;
        }
        done += 1;
        measurable = true;
    }
    return measurable ? Math.round((done / items.length) * 100) : null;
}

// held updates that wait for the same panels on one computer: one Stop and
// update runs them all, stopping those panels' processes once
export interface UpdateHoldGroup {
    keys: string[];
    computerId: string;
    computerName: string | null;
    // what needs updating, by name
    names: string[];
    // who is using it ("Paperboard" for processes the app started itself)
    users: string[];
}

export function groupHolds(holds: UpdateHold[]): UpdateHoldGroup[] {
    const groups = new Map<string, UpdateHoldGroup>();
    for (const hold of holds) {
        const users = [...new Set(hold.users)].sort();
        const id = `${hold.computerId}\u0000${users.join("\u0000")}`;
        const group = groups.get(id);
        if (group) {
            group.keys.push(hold.key);
            group.names.push(hold.name);
        } else {
            groups.set(id, { keys: [hold.key], computerId: hold.computerId, computerName: hold.computerName, names: [hold.name], users });
        }
    }
    return [...groups.values()];
}

export function listOf(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** what a group needs: "Game Server and Java 21 need updating" */
export function holdGroupTitle(group: UpdateHoldGroup): string {
    const where = group.computerName ? ` on ${group.computerName}` : "";
    return `${listOf(group.names)}${where} ${group.names.length > 1 ? "need" : "needs"} updating`;
}

/** what holds a group back: "Game Server is using them" */
export function holdGroupReason(group: UpdateHoldGroup): string {
    const panels = group.users.filter((user) => user !== "Paperboard");
    const using = panels.length === 0
        ? "Paperboard's processes are"
        : `${listOf(panels)} ${panels.length === 1 ? "is" : "are"}`;
    return `${using} using ${group.names.length > 1 ? "them" : "it"}`;
}

/** "Game Server and Java 21 need updating, but Game Server is using them." */
export function holdGroupText(group: UpdateHoldGroup): string {
    return `${holdGroupTitle(group)}, but ${holdGroupReason(group)}.`;
}
