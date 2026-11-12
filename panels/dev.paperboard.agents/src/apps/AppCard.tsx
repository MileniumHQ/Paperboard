// An app the agent showed the user: its picture, its name and what it's for,
// and Open, which puts it beside the chat. It is never a link.

import { Show, createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { AppEntry } from "../contract";
import { failure, type Failure } from "../lib/failure";
import type { Launcher } from "./launcher";
import Picture from "./Picture";
import styles from "./AppCard.module.css";

export default function AppCard(props: { entry: AppEntry; apps: Launcher }) {
    const e = () => props.entry;
    const there = () => props.apps.exists(e().app);
    const [error, setError] = createSignal<Failure | null>(null);
    const [busy, setBusy] = createSignal(false);

    const open = () => {
        setError(null);
        setBusy(true);
        props.apps
            .open(e().app)
            .catch((err) => setError(failure("App not opened", err)))
            .finally(() => setBusy(false));
    };

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={e().title} data-message={e().id}>
                {/* in the narrow column beside an open app, Open wraps under the
                    text instead of squeezing it to a word per line */}
                <PaperFlex direction="row" align="center" gap="full" wrap>
                    <Show when={there()} fallback={<PaperIcon>delete</PaperIcon>}>
                        <Picture apps={props.apps} name={e().app} title={e().title} taken />
                    </Show>
                    <PaperFlex class={styles.text} gap="onefourth">
                        <PaperText preset="label">
                            {e().title}
                        </PaperText>
                        <PaperText preset="hint">
                            {there() ? e().description : "This app was deleted."}
                        </PaperText>
                    </PaperFlex>
                    <Show when={there()}>
                        <PaperButton class={styles.open} variant="text" disabled={busy()} onClick={open}>
                            Open <PaperIcon>open_in_new</PaperIcon>
                        </PaperButton>
                    </Show>
                </PaperFlex>
                <Show when={error()}>
                    {(shown) => (
                        <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setError(null)}>
                            {shown().message}
                        </PaperQuote>
                    )}
                </Show>
            </PaperCard>
        </PaperFlex>
    );
}
