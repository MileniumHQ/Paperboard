import { createEffect, createMemo, createResource, on } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";
import type { HeadFetch } from "../lib/skins";
import { errorMessage } from "../lib/failure";

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
 * Renders the generic person icon until the head resolves (or when the
 * player has none), an error glyph naming the reason when the lookup
 * fails, and never another player's head while the next one loads.
 * `onFailure` hears that reason (null once a head loads), for a page that
 * also says it in words: a phone shows no tooltip.
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
    onFailure?: (reason: string | null) => void;
}) {
    const key = createMemo(() => `${(props.uuid ?? "").toLowerCase()}:${props.name.toLowerCase()}`);
    const [head] = createResource(key, async (k) => {
        try {
            const src = (await props.loadHead({ name: props.name, uuid: props.uuid, size: 64 })) ?? null;
            remember(k, src);
            return { key: k, src, failed: null };
        } catch (err) {
            // a head that could not be looked up says why on the head itself
            return { key: k, src: null, failed: `${props.name}'s head could not be loaded: ${errorMessage(err)}` };
        }
    });
    // a resource keeps its last value while the next loads: that value is
    // only drawn while it is still this player's
    const loaded = () => {
        const latest = head.latest;
        return latest && latest.key === key() ? latest : null;
    };
    const failed = () => loaded()?.failed ?? null;
    createEffect(on(failed, (reason) => props.onFailure?.(reason)));
    return (
        <PaperAvatar
            src={loaded() ? loaded()!.src ?? undefined : drawn.get(key()) ?? undefined}
            alt={props.alt}
            title={failed() ?? undefined}
            role={failed() ? "img" : undefined}
            aria-label={failed() ?? undefined}
            size={props.size ?? "medium"}
            shape={props.shape ?? "sharp"}
            fallbackIcon={failed() ? "error" : "person"}
            accent={failed() ? "danger" : undefined}
            class={props.class}
        />
    );
}
