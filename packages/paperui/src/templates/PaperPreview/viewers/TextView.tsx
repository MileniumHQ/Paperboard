import styles from "./viewers.module.css";
import { Failure } from "./Failure";
import { Match, Show, Switch } from "solid-js";
import { PaperCode } from "../../../components/PaperCode";
import { PaperLoader } from "../../../components/PaperLoader";
import { PaperMarkdown } from "../../../components/PaperMarkdown";
import { PaperText } from "../../../components/PaperText";
import { PAPER_PREVIEW_TEXT_BYTES, previewLanguage } from "../kinds";
import { createTextRead } from "./read";

/** Markdown on a page, and code and plain text in PaperCode, read up to the preview's cap. */
// the most of a file PaperCode highlights
const HIGHLIGHT_CHARS = 256 * 1024;

export function TextView(props: {
    src: string;
    name: string;
    kind: "markdown" | "code" | "text";
    language?: string;
    onError: (message: string) => void;
}) {
    const read = createTextRead(
        () => props.src,
        (message) => props.onError(`${props.name} ${message}`),
    );
    // highlighting runs on the page's thread: past a few hundred kilobytes
    // (a minified bundle, a dump on one line) it would stall it, so the
    // whole of a big file shows plain
    const language = () =>
        (read.value()?.text.length ?? 0) > HIGHLIGHT_CHARS ? "text" : (props.language ?? (props.kind === "code" ? previewLanguage(props.name) : "text"));

    return (
        <Switch>
            <Match when={read.error()}>
                <Failure title={`${props.name} ${read.error()}`} />
            </Match>
            <Match when={!read.value()}>
                <PaperLoader class={styles.centered} loaderStatus="indeterminate" delay={150} label={`Loading ${props.name}`} />
            </Match>
            <Match when={props.kind === "markdown"}>
                <div class={`${styles.sheet} ${styles.document}`}>
                    <PaperMarkdown text={read.value()!.text} />
                    <Cut shown={read.value()!.cut} what="the first" />
                </div>
            </Match>
            <Match when={true}>
                <div class={styles.code}>
                    <PaperCode block class={styles.codeBlock} language={language()}>
                        {read.value()!.text}
                    </PaperCode>
                    <Cut shown={read.value()!.cut} what="the first" />
                </div>
            </Match>
        </Switch>
    );
}

export function Cut(props: { shown: boolean; what: string; rows?: string }) {
    return (
        <Show when={props.shown}>
            <PaperText size={2} color="text-subtle" class={styles.cut}>
                {props.rows ?? `Showing ${props.what} ${PAPER_PREVIEW_TEXT_BYTES / 1024 / 1024} MB.`}
            </PaperText>
        </Show>
    );
}
