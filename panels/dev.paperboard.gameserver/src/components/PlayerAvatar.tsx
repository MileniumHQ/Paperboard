import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";

/**
 * A player of a game with no skins to fetch: every such game draws the same
 * square figure, a robot for a bot.
 */
export default function PlayerAvatar(props: { name: string; size: PaperAvatarSize; bot?: boolean }) {
    return <PaperAvatar size={props.size} shape="square" alt={props.name} fallbackIcon={props.bot ? "smart_toy" : "person"} />;
}
