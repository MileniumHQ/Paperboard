import type { PaperAvatarSize } from "@mileniumhq/paperui";
import { headsFrom } from "../lib/skins";
import { useServer } from "../lib/server";
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
    return <HeadAvatar {...props} loadHead={headsFrom(useServer().calls)} />;
}
