// Where a browser host (the desktop's browser mode, Paperboard web) puts a
// panel: /_panel/<computerId>/<panelId>/ on the shell's own origin. Electron
// serves each panel from its own panel://<computerId>.<panelId>/ origin
// instead. Panels load their assets by relative URLs, so they resolve under
// the folder.
import { isPanelId, requirePanelId } from "./panelIdentity";

export const PANEL_PATH_ROOT = "/_panel/";

// computer ids are the host's own names for them ("local", a remote's id, a
// cloud device id); one path segment each
const COMPUTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function requireComputerId(computerId: string): string {
    if (!COMPUTER_ID_PATTERN.test(computerId)) {
        throw new Error(`A computer id can't be part of a panel address: ${JSON.stringify(computerId)}`);
    }
    return computerId;
}

/** The path of one computer's copy of one panel, ending in its folder's
 * slash, followed by `subpath` inside it. */
export function panelPath(computerId: string, panelId: string, subpath = ""): string {
    const rest = subpath.replace(/^\.?\/+/, "");
    return `${PANEL_PATH_ROOT}${requireComputerId(computerId)}/${requirePanelId(panelId)}/${rest}`;
}

/** The computer, panel and file a path names, or null when it isn't a
 * panel's. `subpath` has no leading slash; "" is the panel's folder. */
export function parsePanelPath(pathname: string): { computerId: string; panelId: string; subpath: string } | null {
    if (!pathname.startsWith(PANEL_PATH_ROOT)) return null;
    const [computerId, panelId, ...rest] = pathname.slice(PANEL_PATH_ROOT.length).split("/");
    if (!computerId || !COMPUTER_ID_PATTERN.test(computerId) || !isPanelId(panelId) || rest.length === 0) return null;
    return { computerId, panelId, subpath: rest.join("/") };
}
