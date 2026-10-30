import { createResource } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import type { HeadLoader } from "../lib/headCache";

/**
 * A Minecraft player head, composited from Mojang's skin service by the
 * daemon, through the given cache. Renders the generic person icon until (or
 * unless) the head resolves. PlayerHead is this over the panel's own cache.
 */
export default function HeadAvatar(props: {
    name: string;
    uuid?: string;
    loader: HeadLoader;
    size?: PaperAvatarSize;
    shape?: "circle" | "square" | "sharp";
    alt?: string;
    class?: string;
}) {
    const [head] = createResource(
        () => `${props.uuid ?? ""}:${props.name}`,
        () => props.loader.loadHead({ name: props.name, uuid: props.uuid, size: 64 }),
    );
    return (
        <PaperAvatar
            // a head already in the cache paints on the first frame instead
            // of flashing the fallback while the resource settles
            src={head() ?? props.loader.peekHead(props.name, props.uuid) ?? undefined}
            alt={props.alt}
            size={props.size ?? "medium"}
            shape={props.shape ?? "sharp"}
            fallbackIcon="person"
            class={props.class}
        />
    );
}
