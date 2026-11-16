// A page the agent showed the user: its picture, its name and what it's for,
// and Open, which puts it beside the chat. It is never a link.

import { Show } from "solid-js";
import { PaperButton, PaperCard, PaperError, PaperFlex, PaperIcon, PaperText, createAction } from "@mileniumhq/paperui";
import type { PageEntry } from "../contract";
import type { Launcher } from "./launcher";
import Picture from "./Picture";
import styles from "./PageCard.module.css";

export default function PageCard(props: { entry: PageEntry; pages: Launcher }) {
    const e = () => props.entry;
    const there = () => props.pages.exists(e().app);
    const { busy, run } = createAction();
    const open = () => void run("Couldn't open the page", () => props.pages.open(e().app));

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
                {/* the pages were never read: whether this one is still there isn't known */}
                <Show when={props.pages.list() === null && props.pages.listError()}>
                    {(err) => <PaperError title="Couldn't check that it's still there" error={err()} action={{ label: "Try again", disabled: props.pages.loading(), onClick: () => void props.pages.reload() }} />}
                </Show>
            </PaperCard>
        </PaperFlex>
    );
}
