// Reading saved flows: what the page sends and what config holds are both
// checked here, so a broken file is refused with its reason, never half-run.
import type { SavedFlows } from "../panel";

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function readFlows(raw: unknown): SavedFlows {
    if (!isRecord(raw)) throw new Error("The saved flows are not an object");
    const { workspace, schemas } = raw;
    if (!isRecord(workspace)) throw new Error("The saved flows have no workspace");
    if (workspace.blocks !== undefined) {
        if (!isRecord(workspace.blocks) || !Array.isArray(workspace.blocks.blocks)) throw new Error("The saved workspace's blocks are not a list");
        for (const block of workspace.blocks.blocks) {
            if (!isRecord(block) || typeof block.type !== "string" || typeof block.id !== "string") throw new Error("A saved block has no type or id");
        }
    }
    if (workspace.variables !== undefined && !Array.isArray(workspace.variables)) throw new Error("The saved workspace's variables are not a list");
    if (!isRecord(schemas)) throw new Error("The saved flows have no block schemas");
    for (const [type, entry] of Object.entries(schemas)) {
        if (!isRecord(entry) || typeof entry.panelId !== "string" || typeof entry.entry !== "string" || !isRecord(entry.schema)) {
            throw new Error(`The saved schema for "${type}" is broken`);
        }
    }
    return { workspace: workspace as SavedFlows["workspace"], schemas: schemas as SavedFlows["schemas"] };
}
