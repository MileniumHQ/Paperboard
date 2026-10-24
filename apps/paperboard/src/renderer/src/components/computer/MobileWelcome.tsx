import { Show, type JSX } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperText } from "@mileniumhq/paperui";
import paperboardIcon from "../../assets/Paperboard.png";
import craneIcon from "../../assets/welcome/crane.png";
import gameServerIcon from "../../assets/welcome/game-server.png";
import styles from "./MobileWelcome.module.css";

// A phone runs no panels of its own: until it is paired with a computer,
// the whole screen is this welcome, the way an app opens on its sign-in.
export default function MobileWelcome(props: {
    onAdd: () => void;
    /** the paired computers couldn't be read; they may exist */
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}): JSX.Element {
    return (
        <main class={styles.welcome} aria-labelledby="mobile-welcome-title">
            {/* the paper icons from paperdocs, fanned like a hand of cards */}
            <div class={styles.stack} aria-hidden="true">
                <img class={styles.left} src={craneIcon} alt="" />
                <img class={styles.right} src={gameServerIcon} alt="" />
                <img class={styles.front} src={paperboardIcon} alt="" />
            </div>
            <div class={styles.copy}>
                <h1 id="mobile-welcome-title" class={styles.title}>Welcome to Paperboard</h1>
                <PaperText as="p" size={3} color="text-muted" class={styles.lead}>
                    Pair a computer running Paperboard to use its panels from here.
                </PaperText>
            </div>
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
        </main>
    );
}
