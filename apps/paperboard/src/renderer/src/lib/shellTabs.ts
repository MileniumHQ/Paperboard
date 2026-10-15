// A computer's tabs are its panels plus these pages the shell draws itself.
// Panel ids can never take these names: library, settings and landing are
// reserved ids (packages/paperapi/src/panelIdentity.ts).
const SHELL_TABS: ReadonlySet<string> = new Set(["landing", "library", "settings"]);

/** true when the tab is a shell page, not a panel */
export function isShellTab(tab: string): boolean {
    return SHELL_TABS.has(tab);
}
