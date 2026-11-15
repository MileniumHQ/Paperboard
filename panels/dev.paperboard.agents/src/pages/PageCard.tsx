// A page the agent showed the user: its picture, its name and what it's for,
// and Open, which puts it beside the chat. It is never a link.

import { Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { PageEntry } from "../contract";
import { createAction } from "../lib/action";
import type { Launcher } from "./launcher";
import Picture from "./Picture";
import styles from "./PageCard.module.css";

export default function PageCard(props: { entry: PageEntry; pages: Launcher }) {
    const e = () => props.entry;
    const there = () => props.pages.exists(e().app);
    const { busy, error, setError, run } = createAction();
    const open = () => void run("Page not opened", () => props.pages.open(e().app));

    return (
        <PaperFlex direction="row">
            <PaperCard fullWidth={false} shrink maxWidth="panel-small" padding="full" gap="half" role="region" aria-label={e().title} data-message={e().id}>
                {/* in the narrow column beside an open page, Open wraps under the
                    text instead of squeezing it to a word per line */}
                <PaperFlex direction="row" align="center" gap="full" wrap>
                    <Show when={there()} fallback={<PaperIcon>delete</PaperIcon>}>
                        <Picture pages={props.pages} name={e().app} title={e().title} />
                    </Show>
                    <PaperFlex class={styles.text} gap="onefourth">
                        <PaperText preset="label">
                            {e().title}
                        </PaperText>
                        <PaperText preset="hint">
                            {there() ? e().description : "This page was deleted."}
                        </PaperText>
                    </PaperFlex>
                    <Show when={there()}>
                        <PaperButton class={styles.open} variant="text" disabled={busy()} onClick={open}>
                            Open <PaperIcon>open_in_new</PaperIcon>
                        </PaperButton>
                    </Show>
                </PaperFlex>
                {/* the pages were never read: whether this one is still there isn't known, and the card says why */}
                <Show when={props.pages.list() === null && props.pages.listError()}>
                    {(why) => (
                        <>
                            <PaperQuote variant="danger" icon="error" title="The pages can't be read" role="alert">
                                {why()}
                            </PaperQuote>
                            <PaperFlex direction="row">
                                <PaperButton size="small" onClick={() => props.pages.reload()}>
                                    Try again
                                </PaperButton>
                            </PaperFlex>
                        </>
                    )}
                </Show>
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
