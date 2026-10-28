// An app open beside the chat: a bar of icons over the app itself. The
// address never shows; the app is the agent's, served on this computer.

import { Show } from "solid-js";
import { grantedComputerId } from "@mileniumhq/paperapi";
import { PaperButton, PaperEmptyState, PaperFlex, PaperText } from "@mileniumhq/paperui";
import type { OpenApp } from "./launcher";
import styles from "./AppView.module.css";

export default function AppView(props: { app: OpenApp; extended: boolean; phone: boolean; onExtend: () => void; onClose: () => void }) {
    let frame: HTMLIFrameElement | undefined;
    // the app is served on the agent's computer's loopback, which a screen elsewhere can't reach
    const here = grantedComputerId() === "local";

    return (
        <div class={styles.view}>
            <PaperFlex direction="row" align="center" gap="half" padding="half">
                <Show when={!props.phone}>
                    <PaperButton
                        icon
                        variant="text"
                        aria-label={props.extended ? "Show the chat" : "Hide the chat"}
                        title={props.extended ? "Show the chat" : "Hide the chat"}
                        onClick={() => props.onExtend()}
                    >
                        {props.extended ? "close_fullscreen" : "open_in_full"}
                    </PaperButton>
                </Show>
                <PaperButton icon variant="text" aria-label="Reload" title="Reload" disabled={!here} onClick={() => frame && (frame.src = props.app.url)}>
                    refresh
                </PaperButton>
                <PaperFlex flex minWidth={0} align="center">
                    <PaperText size={3} weight={600} truncate>
                        {props.app.title}
                    </PaperText>
                </PaperFlex>
                <PaperButton icon variant="text" aria-label="Close" title="Close" onClick={() => props.onClose()}>
                    close
                </PaperButton>
            </PaperFlex>
            <Show
                when={here}
                fallback={
                    <PaperFlex flex center>
                        <PaperEmptyState
                            icon="desktop_access_disabled"
                            title="Open it on the computer it's on"
                            description="Apps are served on the agent's computer, and only a screen on that computer can reach them."
                        />
                    </PaperFlex>
                }
            >
                {/* its own origin: the app can't reach into the panel, nor the panel into it */}
                <iframe ref={frame} class={styles.frame} src={props.app.url} title={props.app.title} sandbox="allow-scripts allow-forms allow-same-origin" />
            </Show>
        </div>
    );
}
