import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import { createServedPicture } from "../lib/pictures";
import type { PictureSource } from "../service/contract";

/**
 * An avatar of a picture from elsewhere (an add-on's icon, a Workshop
 * preview), fetched by the service. Shows `fallbackIcon` while it loads and
 * when there is none, and an error glyph naming the reason when it fails.
 */
export default function PictureAvatar(props: {
    from: PictureSource;
    url?: string | null;
    fallbackIcon: string;
    alt?: string;
    size?: PaperAvatarSize;
    shape?: "circle" | "square" | "sharp";
}) {
    const picture = createServedPicture(() => props.from, () => props.url);
    const failed = () => (picture.error() === null ? undefined : `The picture couldn't be loaded: ${picture.error()}`);
    return (
        <PaperAvatar
            src={picture.src()}
            alt={props.alt}
            title={failed()}
            role={failed() ? "img" : undefined}
            aria-label={failed()}
            size={props.size}
            shape={props.shape}
            fallbackIcon={failed() ? "error" : props.fallbackIcon}
            accent={failed() ? "danger" : undefined}
        />
    );
}
