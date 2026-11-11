// The trash, as the Actions canvas has it: a tile in the corner a block is
// dropped on to delete it. The tile is the page's own element; this tells
// Blockly where it is, so a block dragged over it is deleted on drop.
import * as Blockly from "blockly";

export interface TrashState {
    /** a block is being dragged */
    dragging: boolean;
    /** the dragged block is over the trash, and would be deleted */
    over: boolean;
}

class TrashZone extends Blockly.DeleteArea {
    override id = "paperTrash";

    constructor(
        private readonly element: HTMLElement,
        private readonly onChange: (state: TrashState) => void,
    ) {
        super();
    }

    override getClientRect(): Blockly.utils.Rect {
        const r = this.element.getBoundingClientRect();
        return new Blockly.utils.Rect(r.top, r.bottom, r.left, r.right);
    }

    override onDragEnter(element: Blockly.IDraggable): void {
        super.onDragEnter(element);
        this.onChange({ dragging: true, over: this.wouldDelete(element) });
    }

    override onDragExit(element: Blockly.IDraggable): void {
        super.onDragExit(element);
        this.onChange({ dragging: true, over: false });
    }

    override onDrop(element: Blockly.IDraggable): void {
        super.onDrop(element);
        this.onChange({ dragging: false, over: false });
    }
}

/** Makes `element` the workspace's trash; `onChange` hears when a drag nears it and ends. */
export function addTrash(workspace: Blockly.WorkspaceSvg, element: HTMLElement, onChange: (state: TrashState) => void): void {
    const trash = new TrashZone(element, onChange);
    workspace.getComponentManager().addComponent({
        component: trash,
        weight: Blockly.ComponentManager.ComponentWeight.TRASHCAN_WEIGHT,
        capabilities: [Blockly.ComponentManager.Capability.DELETE_AREA, Blockly.ComponentManager.Capability.DRAG_TARGET],
    });
    // the tile dims in while anything is dragged, as Actions' does
    workspace.addChangeListener((event: Blockly.Events.Abstract) => {
        if (event.type !== Blockly.Events.BLOCK_DRAG) return;
        const drag = event as Blockly.Events.BlockDrag;
        onChange({ dragging: Boolean(drag.isStart), over: false });
    });
}
