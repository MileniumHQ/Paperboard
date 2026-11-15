import type { PaperAvatarSize } from "@mileniumhq/paperui";
import { loadHead } from "../lib/skins";
import HeadAvatar from "./HeadAvatar";

/** A Minecraft player head, over the panel's bridge. */
export default function PlayerHead(props: {
    name: string;
    uuid?: string;
    size?: PaperAvatarSize;
    shape?: "circle" | "square" | "sharp";
    alt?: string;
    class?: string;
    onFailure?: (reason: string | null) => void;
}) {
    return <HeadAvatar {...props} loadHead={loadHead} />;
}
