// A project's flows as a file: what File > Export writes and Import reads.
// It is the saved canvas (Blockly's workspace, and the schema of each panel
// block on it), marked so another file is refused with a reason.
import type { SavedFlows } from "../panel";
import { readFlows } from "./flows";

export const FLOW_FILE_FORMAT = "paperboard-blocks";
export const FLOW_FILE_VERSION = 1;
/** a flow file is text a person made with blocks; more than this is not one */
export const MAX_FLOW_FILE_BYTES = 8 * 1024 * 1024;

export function flowFileText(flows: SavedFlows): string {
    return JSON.stringify({ format: FLOW_FILE_FORMAT, version: FLOW_FILE_VERSION, ...flows }, null, 2);
}

export function parseFlowFile(text: string): SavedFlows {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error("This file isn't a Blocks flow file: it isn't JSON.");
    }
    const file = raw as { format?: unknown; version?: unknown };
    if (!file || typeof file !== "object" || file.format !== FLOW_FILE_FORMAT) throw new Error("This file isn't a Blocks flow file.");
    if (typeof file.version !== "number" || file.version > FLOW_FILE_VERSION) {
        throw new Error(`This file was made by a newer version of Blocks (version ${String(file.version)}); update Blocks to import it.`);
    }
    const flows = readFlows(raw);
    if (!flows.workspace.blocks?.blocks.length) throw new Error("This flow file has no blocks in it.");
    return flows;
}
