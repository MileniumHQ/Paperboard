// A computer's tabs are its panels plus these pages the shell draws itself.
// Panel ids can never take these names: library, settings and landing are
// reserved ids and shell- is a reserved prefix (packages/paperapi/src/panelIdentity.ts).
export const BACKUPS_TAB = "shell-backups";

const SHELL_TABS: ReadonlySet<string> = new Set(["landing", "library", "settings", BACKUPS_TAB]);

/** true when the tab is a shell page, not a panel */
export function isShellTab(tab: string): boolean {
    return SHELL_TABS.has(tab);
}
