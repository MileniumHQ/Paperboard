// One block in the Library: a static preview that a press drags onto the
// canvas.
import type { ActionInfo } from "@mileniumhq/paperapi";
import ActionBlock from "../ActionBlock";

export type LibraryPress = (item: ActionInfo, isTrigger: boolean, e: PointerEvent, iconUrl?: string) => void;

export default function LibraryItem(props: {
    item: ActionInfo;
    isTrigger: boolean;
    iconUrl?: string;
    onPress: LibraryPress;
}) {
    return (
        <div
            class="library-block-wrapper"
            onPointerDown={(e) => props.onPress(props.item, props.isTrigger, e, props.iconUrl)}
        >
            <ActionBlock
                action={
                    props.item.schema || {
                        id: props.item.action,
                        name: props.item.action,
                        description: "",
                    }
                }
                isTrigger={props.isTrigger}
                iconSrc={props.iconUrl}
                static={true}
            />
        </div>
    );
}
