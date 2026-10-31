import { createMemo, createResource } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import type { HeadFetch } from "../lib/skins";

// the last head drawn for each player, so a row or an inspector paints it
// at once instead of the fallback. It is only a first frame: every head asks
// the service again, and the service's answer replaces it.
const drawn = new Map<string, string | null>();
const MAX_DRAWN = 512;

function remember(key: string, head: string | null): void {
    drawn.delete(key);
    drawn.set(key, head);
    while (drawn.size > MAX_DRAWN) drawn.delete(drawn.keys().next().value!);
}

/**
 * A Minecraft player head, composited by the daemon from Mojang's skin
 * service (GeyserMC's for Bedrock players), asked for through `loadHead`.
 * Renders the generic person icon until (or unless) the head resolves, and
 * never another player's head while the next one loads.
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
    const key = createMemo(() => `${(props.uuid ?? "").toLowerCase()}:${props.name.toLowerCase()}`);
    const [head] = createResource(key, async (k) => {
        const src = await props.loadHead({ name: props.name, uuid: props.uuid, size: 64 }).catch((err) => {
            // a missing head falls back to the generic icon; log so a
            // broken lookup is visible rather than silently absent
            console.warn(`[skins] head lookup failed for "${props.uuid || props.name}":`, String(err));
            return null;
        });
        remember(k, src ?? null);
        return { key: k, src: src ?? null };
    });
    // a resource keeps its last value while the next loads: that value is
    // only drawn while it is still this player's
    const src = () => {
        const loaded = head.latest;
        if (loaded && loaded.key === key()) return loaded.src ?? undefined;
        return drawn.get(key()) ?? undefined;
    };
    return (
        <PaperAvatar
            src={src()}
            alt={props.alt}
            size={props.size ?? "medium"}
            shape={props.shape ?? "sharp"}
            fallbackIcon="person"
            class={props.class}
        />
    );
}
