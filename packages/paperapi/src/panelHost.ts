// A panel's origin as one DNS label. Electron serves panels from
// panel://<computerId>.<panelId>/ and the desktop's browser mode nests the
// same two names under its host, but a public host can only hold a
// certificate for one level of names under it (*.example.com). This label
// carries both names in that one level and reads back exactly, so a host
// serving panels from <label>.<its own host> needs no lookup table.
//
// Ids are [a-z0-9._-]; every character but "-", "." and "_" stands for
// itself, those three become "-0", "-1" and "-2", and "-x" separates the
// computer from the panel.

// DNS allows 63 characters in a label
export const PANEL_HOST_LABEL_MAX = 63;

const ESCAPES: Record<string, string> = { "-": "-0", ".": "-1", _: "-2" };
const UNESCAPES: Record<string, string> = { "0": "-", "1": ".", "2": "_" };

function escapeId(id: string, what: string): string {
    let out = "";
    for (const ch of id) {
        if (/[a-z0-9]/.test(ch)) out += ch;
        else if (ESCAPES[ch]) out += ESCAPES[ch];
        else throw new Error(`A ${what} id can't be part of a panel address: ${JSON.stringify(id)}`);
    }
    return out;
}

/** The label for one computer's copy of one panel. Throws when the two ids
 * don't fit in a label; a host can't serve that panel from its own name. */
export function panelHostLabel(computerId: string, panelId: string): string {
    if (!computerId) throw new Error("A panel address needs a computer id");
    if (!panelId) throw new Error("A panel address needs a panel id");
    const label = `${escapeId(computerId, "computer")}-x${escapeId(panelId, "panel")}`;
    if (label.length > PANEL_HOST_LABEL_MAX) {
        throw new Error(`The panel ${panelId} has an id too long to be served from its own web address`);
    }
    return label;
}

/** The computer and panel a label names, or null when it isn't one. */
export function parsePanelHostLabel(label: string): { computerId: string; panelId: string } | null {
    if (!label || label.length > PANEL_HOST_LABEL_MAX) return null;
    const ids: string[] = [""];
    for (let i = 0; i < label.length; i++) {
        const ch = label[i]!;
        if (/[a-z0-9]/.test(ch)) {
            ids[ids.length - 1] += ch;
            continue;
        }
        if (ch !== "-") return null;
        const next = label[++i];
        if (next === "x") {
            if (ids.length === 2) return null;
            ids.push("");
        } else if (next !== undefined && UNESCAPES[next]) {
            ids[ids.length - 1] += UNESCAPES[next];
        } else {
            return null;
        }
    }
    if (ids.length !== 2 || !ids[0] || !ids[1]) return null;
    return { computerId: ids[0], panelId: ids[1] };
}
