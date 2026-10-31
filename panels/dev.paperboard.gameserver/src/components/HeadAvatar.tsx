import { createResource } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import type { HeadFetch } from "../lib/skins";

/**
 * A Minecraft player head, composited by the daemon from Mojang's skin
 * service (GeyserMC's for Bedrock players), asked for through `loadHead`.
 * Renders the generic person icon until (or unless) the head resolves.
 * PlayerHead is this over the panel's own bridge.
 */
export default function HeadAvatar(props: {
    name: string;
    uuid?: string;
    loadHead: HeadFetch;
    size?: PaperAvatarSize;
    shape?: "circle" | "square" | "sharp";
    alt?: string;
    class?: string;
}) {
    const [head] = createResource(
        () => `${props.uuid ?? ""}:${props.name}`,
        () =>
            props.loadHead({ name: props.name, uuid: props.uuid, size: 64 }).catch((err) => {
                // a missing head falls back to the generic icon; log so a
                // broken lookup is visible rather than silently absent
                console.warn(`[skins] head lookup failed for "${props.uuid || props.name}":`, String(err));
                return null;
            }),
    );
    return (
        <PaperAvatar
            src={head() ?? undefined}
            alt={props.alt}
            size={props.size ?? "medium"}
            shape={props.shape ?? "sharp"}
            fallbackIcon="person"
            class={props.class}
        />
    );
}
