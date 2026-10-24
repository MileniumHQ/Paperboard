// The phone layout runs no panels of its own: the computer the app runs on
// (This Computer) is the desktop's, so a phone lists only paired computers,
// and with none it opens on the welcome page instead of Home.

interface ListedComputer {
    isLocal?: boolean;
}

/** the computers the shell lists: every one on the desktop, the paired ones on a phone */
export function shownComputers<T extends ListedComputer>(computers: T[], mobile: boolean): T[] {
    return mobile ? computers.filter((c) => !c.isLocal) : computers;
}

/** whether the phone opens on its welcome page: nothing paired to show */
export function showsWelcome(computers: ListedComputer[], mobile: boolean): boolean {
    return mobile && shownComputers(computers, mobile).length === 0;
}
