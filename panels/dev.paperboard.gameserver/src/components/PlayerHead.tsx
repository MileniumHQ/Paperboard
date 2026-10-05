import { createResource } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@paperboard-dev/paperui";
import { loadHead } from "../lib/skins";

/**
 * A Minecraft player head, composited from Mojang's skin service by the
 * daemon. Renders the generic person icon until (or unless) the head resolves.
 */
export default function PlayerHead(props: {
    name: string;
    uuid?: string;
    size?: PaperAvatarSize;
    shape?: "circle" | "square";
    alt?: string;
    class?: string;
}) {
    const [head] = createResource(
        () => `${props.uuid ?? ""}:${props.name}`,
        () => loadHead({ name: props.name, uuid: props.uuid, size: 64 }),
    );
    return (
        <PaperAvatar
            src={head() ?? undefined}
            alt={props.alt}
            size={props.size ?? "medium"}
            shape={props.shape ?? "square"}
            fallbackIcon="person"
            class={props.class}
        />
    );
}
