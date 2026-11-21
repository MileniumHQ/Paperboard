import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { PaperAvatar, type PaperAvatarSize } from "@mileniumhq/paperui";

/**
 * A player's picture, when their game has one to fetch. A game that has none
 * for a player (a bot, a player of another platform) passes no picture.
 */
export type PlayerPicture =
    /**
     * on its way: the figure waits in an hourglass, so a picture still coming isn't taken for one that doesn't exist.
     * `ask`, when there is one, fetches it: the avatar calls it once it is on screen, so a list of hundreds asks only for the rows shown
     */
    | { state: "loading"; ask?: () => void }
    | { state: "picture"; src: string }
    /** the game's source has no picture for this player, and says why */
    | { state: "none"; why: string }
    /** the picture couldn't be had; `error` says why */
    | { state: "failed"; error: string };

/**
 * A player: their picture when the game supplies one, else the figure every
 * player of a game with no pictures gets (a robot for a bot).
 */
export default function PlayerAvatar(props: { name: string; size: PaperAvatarSize; bot?: boolean; picture?: PlayerPicture }) {
    const picture = () => props.picture;
    const ask = createMemo(() => {
        const current = picture();
        return current?.state === "loading" ? current.ask : undefined;
    });
    const [element, setElement] = createSignal<HTMLElement>();
    // a picture still to ask for is asked for once its avatar is first on screen
    createEffect(
        on([element, ask], ([el, asking]) => {
            if (!el || !asking) return;
            const watch = new IntersectionObserver((entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                watch.disconnect();
                asking();
            });
            watch.observe(el);
            onCleanup(() => watch.disconnect());
        }),
    );
    const src = () => {
        const current = picture();
        return current?.state === "picture" ? current.src : undefined;
    };
    const failed = () => {
        const current = picture();
        return current?.state === "failed" ? `${props.name}'s picture couldn't be loaded: ${current.error}` : undefined;
    };
    const note = () => {
        const current = picture();
        if (current?.state === "loading") return `Loading ${props.name}'s picture`;
        if (current?.state === "none") return current.why;
        return failed();
    };
    return (
        <PaperAvatar
            ref={setElement}
            src={src()}
            alt={props.name}
            title={note()}
            role={failed() ? "img" : undefined}
            aria-label={failed()}
            size={props.size}
            shape="square"
            fallbackIcon={failed() ? "error" : picture()?.state === "loading" ? "hourglass_empty" : props.bot ? "smart_toy" : "person"}
            accent={failed() ? "danger" : undefined}
        />
    );
}
