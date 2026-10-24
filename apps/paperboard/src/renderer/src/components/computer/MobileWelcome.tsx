import { For, Show, type JSX } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperText } from "@mileniumhq/paperui";
import libraryIcon from "../../assets/PanelLibrary.png";
import actionsIcon from "../../assets/welcome/actions.png";
import aiIcon from "../../assets/welcome/ai.png";
import botcreatorIcon from "../../assets/welcome/botcreator.png";
import gameserverIcon from "../../assets/welcome/gameserver.png";
import terminalIcon from "../../assets/welcome/terminal.png";
import styles from "./MobileWelcome.module.css";

// paper tiles fading out from each row's icons, as in the Panel Library banner
const GHOSTS = [0, 1, 2];

// A phone runs no panels of its own: until it is paired with a computer,
// the whole screen is this welcome, the way an app opens on its sign-in.
// It is drawn like the Panel Library: a banner of panel icons, then the page.
export default function MobileWelcome(props: {
    onAdd: () => void;
    /** the paired computers couldn't be read; they may exist */
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}): JSX.Element {
    const row = (icons: string[], side: "start" | "end") => (
        <div class={styles.row} classList={{ [styles.end]: side === "end" }} aria-hidden="true">
            <For each={icons}>{(src) => <img class={styles.icon} src={src} alt="" />}</For>
            <For each={GHOSTS}>{(i) => <span class={styles.ghost} style={{ opacity: String(0.9 - i * 0.3) }} />}</For>
        </div>
    );

    return (
        <main class={styles.welcome} aria-labelledby="mobile-welcome-title">
            <div class={styles.column}>
                <section class={styles.banner}>
                    {row([gameserverIcon, terminalIcon, actionsIcon], "start")}
                    <div class={styles.heading}>
                        <h1 id="mobile-welcome-title" class={styles.title}>Paperboard</h1>
                        <p class={styles.subtitle}>Your computers' panels, on your phone.</p>
                    </div>
                    {row([aiIcon, libraryIcon, botcreatorIcon], "end")}
                </section>

                <PaperText as="p" size={3} color="text-muted" class={styles.lead}>
                    Pair a computer running Paperboard to use its panels from here.
                </PaperText>

                <Show when={props.loadFailed}>
                    <div class={styles.failure} role="alert">
                        <PaperText as="p" size={2} color="text-muted">
                            Couldn't load your paired computers.
                        </PaperText>
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
        </main>
    );
}
