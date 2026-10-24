import { For, Show, onCleanup, onMount, type JSX } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, haptic } from "@mileniumhq/paperui";
import paperboardIcon from "../../assets/Paperboard.png";
import libraryIcon from "../../assets/PanelLibrary.png";
import actionsIcon from "../../assets/welcome/actions.png";
import aiIcon from "../../assets/welcome/ai.png";
import botcreatorIcon from "../../assets/welcome/botcreator.png";
import gameserverIcon from "../../assets/welcome/gameserver.png";
import terminalIcon from "../../assets/welcome/terminal.png";
import { createIconPlay } from "../../lib/iconPlay/iconPlay";
import { logToMain } from "../../lib/shell";
import styles from "./MobileWelcome.module.css";

const ICONS = [paperboardIcon, gameserverIcon, terminalIcon, actionsIcon, botcreatorIcon, libraryIcon, aiIcon];
/** ms between felt impacts, so a pile-up is a patter, not a buzz */
const IMPACT_GAP_MS = 160;

// A phone runs no panels of its own: until it is paired with a computer,
// the whole screen is this welcome, the way an app opens on its sign-in.
// Its paper icons are paperdocs' landing toys: fling one and it bounces.
export default function MobileWelcome(props: {
    onAdd: () => void;
    /** the paired computers couldn't be read; they may exist */
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}): JSX.Element {
    let field: HTMLElement | undefined;
    let copy: HTMLDivElement | undefined;
    const icons: HTMLImageElement[] = [];

    onMount(() => {
        if (!field || !copy) return;
        let lastImpact = 0;
        const play = createIconPlay(field, icons, {
            size: icons[0]?.getBoundingClientRect().width || 72,
            avoid: () => (copy ? [copy] : []),
            reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-paperui-motion"),
            onImpact: () => {
                const now = performance.now();
                if (now - lastImpact < IMPACT_GAP_MS) return;
                lastImpact = now;
                haptic("selection");
            },
            onTap: () => haptic("light"),
        });
        // without the toy the icons stay hidden; the page still works
        play.ready.catch((err) => {
            if (field) field.dataset.play = "unavailable";
            logToMain("warn", "The welcome's icons couldn't be placed:", err);
        });
        onCleanup(play.stop);
    });

    return (
        <main ref={field} class={styles.welcome} aria-labelledby="mobile-welcome-title">
            <div ref={copy} class={styles.copy}>
                <div class={styles.heading}>
                    <h1 id="mobile-welcome-title" class={styles.title}>Paperboard</h1>
                    <p class={styles.subtitle}>Pair a computer to use its panels from here.</p>
                </div>
                <Show when={props.loadFailed}>
                    <div class={styles.failure} role="alert">
                        <p>Couldn't load your paired computers.</p>
                        <PaperButton size="small" variant="text" onClick={() => props.onRetryLoad?.()}>
                            <PaperIcon>refresh</PaperIcon>
                            Try again
                        </PaperButton>
                    </div>
                </Show>
                <PaperEffect variant="primary" class={styles.action}>
                    <PaperButton size="large" class={styles.button} onClick={() => props.onAdd()}>
                        <PaperIcon>add</PaperIcon>
                        Add Computer
                    </PaperButton>
                </PaperEffect>
            </div>
            <For each={ICONS}>
                {(src) => <img ref={(el) => icons.push(el)} class={styles.icon} src={src} alt="" aria-hidden="true" draggable={false}
                    // the browser's own long press (save image) isn't for a toy; touch hold's synthetic one passes
                    onContextMenu={(e) => { if (e.isTrusted) e.preventDefault(); }} />}
            </For>
        </main>
    );
}
