import type { PaperAvatarSize } from "@mileniumhq/paperui";
import { loadHead, peekHead } from "../lib/skins";
import HeadAvatar from "./HeadAvatar";

const panelHeads = { loadHead, peekHead };

/** A Minecraft player head from the panel's head cache. */
export default function PlayerHead(props: {
    name: string;
    uuid?: string;
    size?: PaperAvatarSize;
    shape?: "circle" | "square";
    alt?: string;
    class?: string;
}) {
    return <HeadAvatar {...props} loader={panelHeads} />;
}
