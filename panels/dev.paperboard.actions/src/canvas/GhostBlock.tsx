// The block under the pointer while it's dragged in from the Library or out
// of a flow. It follows the pointer, so its position is the one live style.
import ActionBlock from "../components/ActionBlock";
import type { GhostDrag } from "./interaction";

export default function GhostBlock(props: { drag: GhostDrag }) {
    const fallbackId = () => (props.drag.item as any).action || (props.drag.item as any).trigger;
    return (
        <div
            class="ghostDragContainer"
            style={{
                left: `${props.drag.pos.x - props.drag.grabOffset.x}px`,
                top: `${props.drag.pos.y - props.drag.grabOffset.y}px`,
            }}
        >
            <ActionBlock
                action={props.drag.item.schema || { id: fallbackId(), name: fallbackId(), description: "" }}
                isTrigger={props.drag.isTrigger}
                iconSrc={props.drag.iconSrc}
                values={props.drag.values}
                children={props.drag.children}
                elseChildren={(props.drag as any)?.elseChildren}
            />
        </div>
    );
}
