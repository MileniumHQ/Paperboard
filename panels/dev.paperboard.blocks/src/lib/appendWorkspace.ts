// Adds a saved canvas (a flow file's) to the one on screen, as one step a
// single Undo takes back whole.
import * as Blockly from "blockly";
import type { SavedWorkspace } from "./interpreter";
import { withFreshIds } from "./results";

/**
 * Adds the saved variables the canvas lacks, then the saved stacks moved
 * down by `shift`. Every change is recorded in one undo group: were the
 * blocks left out (Blockly's default for append), Undo would delete only the
 * new variables, and with them every block that uses one. Blocks whose ids
 * the canvas has already (a file exported from this project) get new ones,
 * and the file's reporters read its own commands.
 */
export function appendWorkspace(workspace: Blockly.Workspace, saved: SavedWorkspace, shift: number): void {
    const variables = workspace.getVariableMap();
    Blockly.Events.setGroup(true);
    try {
        for (const variable of saved.variables ?? []) {
            if (!variables.getVariableById(variable.id) && !variables.getVariable(variable.name, variable.type ?? "")) {
                variables.createVariable(variable.name, variable.type ?? "", variable.id);
            }
        }
        for (const block of withFreshIds((saved.blocks?.blocks ?? []) as Blockly.serialization.blocks.State[], workspace)) {
            Blockly.serialization.blocks.append({ ...block, y: (block.y ?? 0) + shift }, workspace, { recordUndo: true });
        }
    } finally {
        Blockly.Events.setGroup(false);
    }
}
