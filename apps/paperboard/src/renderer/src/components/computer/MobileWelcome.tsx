import { For, Show, type JSX } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon } from "@mileniumhq/paperui";
import libraryIcon from "../../assets/PanelLibrary.png";
import actionsIcon from "../../assets/welcome/actions.png";
import aiIcon from "../../assets/welcome/ai.png";
import botcreatorIcon from "../../assets/welcome/botcreator.png";
import gameserverIcon from "../../assets/welcome/gameserver.png";
import terminalIcon from "../../assets/welcome/terminal.png";
import styles from "./MobileWelcome.module.css";

// how many frosted rows fade from each band of icons toward the title
const FADES = [0.55, 0.25];

// A phone runs no panels of its own: until it is paired with a computer,
// the whole screen is this welcome, the way an app opens on its sign-in.
// It is the Panel Library banner as a screen: blue, panel icons at the edges
// fading into frosted paper tiles toward the title in the middle.
export default function MobileWelcome(props: {
    onAdd: () => void;
    /** the paired computers couldn't be read; they may exist */
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}): JSX.Element {
    const band = (icons: string[], edge: "top" | "bottom") => (
        <div class={styles.band} classList={{ [styles.bottom]: edge === "bottom" }} aria-hidden="true">
            <div class={styles.row}>
                <For each={icons}>{(src) => <img class={styles.tile} src={src} alt="" />}</For>
            </div>
            <For each={FADES}>
                {(opacity) => (
                    <div class={styles.row} style={{ opacity: String(opacity) }}>
                        <For each={icons}>{() => <span class={styles.ghost} />}</For>
                    </div>
                )}
            </For>
        </div>
    );

    return (
        <main class={styles.welcome} aria-labelledby="mobile-welcome-title">
            {band([gameserverIcon, terminalIcon, actionsIcon], "top")}
            <div class={styles.heading}>
                <h1 id="mobile-welcome-title" class={styles.title}>Paperboard</h1>
                <p class={styles.subtitle}>Pair a computer to use its panels from here.</p>
            </div>
            {band([botcreatorIcon, libraryIcon, aiIcon], "bottom")}
            <div class={styles.actions}>
                <Show when={props.loadFailed}>
                    <div class={styles.failure} role="alert">
                        <p>Couldn't load your paired computers.</p>
                        <PaperButton size="small" variant="text" class={styles.retry} onClick={() => props.onRetryLoad?.()}>
                            <PaperIcon>refresh</PaperIcon>
                            Try again
                        </PaperButton>
                    </div>
                </Show>
                <PaperEffect class={styles.action}>
                    <PaperButton size="large" class={styles.button} onClick={() => props.onAdd()}>
                        <PaperIcon>add</PaperIcon>
                        Add Computer
                    </PaperButton>
                </PaperEffect>
            </div>
        </main>
    );
}
