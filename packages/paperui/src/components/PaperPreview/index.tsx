import styles from "./index.module.css";
import { createResource, Match, Show, splitProps, Switch, type JSX } from "solid-js";
import { ModalLayer } from "../PaperModal/layer";
import { PaperAudio } from "../PaperAudio";
import { PaperButton } from "../PaperButton";
import { PaperCode } from "../PaperCode";
import { PaperEmptyState } from "../PaperEmptyState";
import { PaperIcon } from "../PaperIcon";
import { PaperLoader } from "../PaperLoader";
import { PaperMarkdown } from "../PaperMarkdown";
import { PaperText } from "../PaperText";
import { PaperVideo, prefersNativeVideo } from "../PaperVideo";
import { grammarFor } from "../../utils/highlight";

/** How a file is shown: what PaperPreview draws it with. */
export type PaperPreviewKind = "image" | "video" | "audio" | "markdown" | "code" | "text";

/** The most of a text file a preview reads; past it, the preview says it's cut. */
export const PAPER_PREVIEW_TEXT_BYTES = 1024 * 1024;

// a file's extension, for the language its code is in: the ids PaperCode
// highlights, or the extension itself, which shows plain when PaperCode
// has no grammar for it
const LANGUAGES: Record<string, string> = {
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
    json: "json", jsonc: "json5", json5: "json5", css: "css",
    sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", toml: "toml",
    ini: "ini", cfg: "ini", conf: "ini", properties: "properties",
};
const CODE_EXTENSIONS = new Set([
    ...Object.keys(LANGUAGES),
    "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs",
    "php", "lua", "sql", "html", "htm", "xml", "svelte", "vue", "scss", "less",
    "dockerfile", "makefile", "gradle", "env", "lock", "diff", "patch",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const TEXT_EXTENSIONS = new Set(["txt", "text", "log", "csv", "tsv"]);

function extension(name: string): string {
    const base = name.split(/[\\/]/).pop()!.toLowerCase();
    const dot = base.lastIndexOf(".");
    // a dotless name like Dockerfile is its own extension
    return dot > 0 ? base.slice(dot + 1) : base;
}

/**
 * What a file previews as, from its media type and its name: null when
 * PaperPreview can't show it (a PDF, an archive, a program). A media type
 * names images, video and audio; a name tells markdown and code apart from
 * plain text.
 */
export function previewKind(name: string, type = ""): PaperPreviewKind | null {
    const t = type.toLowerCase().split(";")[0].trim();
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("audio/")) return "audio";
    const ext = extension(name);
    if (t === "text/markdown" || MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
    if (CODE_EXTENSIONS.has(ext)) return "code";
    if (t.startsWith("text/") || t === "application/json" || TEXT_EXTENSIONS.has(ext)) return "text";
    return null;
}

/** The language PaperCode highlights a file's code in; "text" when it has no grammar for it. */
export function previewLanguage(name: string): string {
    const ext = extension(name);
    const language = LANGUAGES[ext] ?? ext;
    return grammarFor(language) ? language : "text";
}

export interface PaperPreviewProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    open?: boolean;
    onClose?: () => void;
    /** The file's address. Until it's set, the preview shows it loading. */
    src?: string;
    /** The file's name: shown above it, and how markdown and code are told apart. */
    name: string;
    /** Its media type, which names images, video and audio. */
    type?: string;
    /** How to show it, when the name and type don't say. */
    kind?: PaperPreviewKind;
    /** The language of code, when its name doesn't say. */
    language?: string;
    /** Why the file can't be shown: drawn in place of it. */
    error?: string;
    /** More buttons beside Close, like a Save. */
    actions?: JSX.Element;
}

/**
 * A file, shown over the page the way PaperModal shows a dialog: an image
 * as itself, a video in PaperVideo (on a phone or tablet, straight in the
 * system's own player), audio in PaperAudio, markdown in
 * PaperMarkdown, and code and plain text in PaperCode. Its Close button
 * sits above it.
 */
export function PaperPreview(props: PaperPreviewProps) {
    const [local, rest] = splitProps(props, [
        "open",
        "onClose",
        "src",
        "name",
        "type",
        "kind",
        "language",
        "error",
        "actions",
        "class",
    ]);

    const kind = () => local.kind ?? previewKind(local.name, local.type);
    const textual = () => kind() === "markdown" || kind() === "code" || kind() === "text";

    const [text] = createResource(
        () => (local.open && textual() && local.src ? local.src : null),
        async (src) => {
            const response = await fetch(src);
            if (!response.ok) throw new Error(`${local.name} couldn't be read (${response.status})`);
            const blob = await response.blob();
            const cut = blob.size > PAPER_PREVIEW_TEXT_BYTES;
            return { text: await blob.slice(0, PAPER_PREVIEW_TEXT_BYTES).text(), cut };
        },
    );

    const failure = () => {
        if (local.error) return local.error;
        if (!kind()) return `${local.name} can't be previewed`;
        if (textual() && text.error) return text.error instanceof Error ? text.error.message : String(text.error);
        return null;
    };
    const loading = () => !local.src || (textual() && (text.loading || !text()));

    // a press on the empty space around the file closes it, as the scrim's does
    const closeOnSpace = (e: MouseEvent) => {
        if (e.target === e.currentTarget) local.onClose?.();
    };

    return (
        <ModalLayer
            open={local.open}
            onClose={local.onClose}
            aria-label={local.name}
            {...rest}
            class={[styles.PaperPreview, local.class].filter(Boolean).join(" ")}
            data-kind={kind() ?? undefined}
            onClick={closeOnSpace}
            content={() => (
                <>
                    <div class={styles.top} onClick={closeOnSpace}>
                        <span class={styles.name} title={local.name}>
                            {local.name}
                        </span>
                        <div class={styles.actions}>
                            {local.actions}
                            <PaperButton size="small" onClick={() => local.onClose?.()}>
                                <PaperIcon zeroHeight>close</PaperIcon>
                                Close
                            </PaperButton>
                        </div>
                    </div>

                    <div class={styles.frame} onClick={closeOnSpace}>
                        <Switch>
                            <Match when={failure()}>
                                <div class={styles.sheet}>
                                    <PaperEmptyState icon="error" title={failure()!} role="alert" />
                                </div>
                            </Match>
                            <Match when={loading()}>
                                <PaperLoader loaderStatus="indeterminate" delay={150} label={`Loading ${local.name}`} />
                            </Match>
                            <Match when={kind() === "image"}>
                                <img class={styles.image} src={local.src} alt={local.name} />
                            </Match>
                            <Match when={kind() === "video"}>
                                {/* a phone goes straight to its own player, and leaving it closes the preview */}
                                <PaperVideo
                                    class={styles.video}
                                    src={local.src!}
                                    label={local.name}
                                    nativePlayer={prefersNativeVideo()}
                                    onNativePlayerClose={() => local.onClose?.()}
                                />
                            </Match>
                            <Match when={kind() === "audio"}>
                                <PaperAudio class={styles.audio} fullWidth src={local.src!} label={local.name} />
                            </Match>
                            <Match when={kind() === "markdown"}>
                                <div class={`${styles.sheet} ${styles.document}`}>
                                    <PaperMarkdown text={text()!.text} />
                                    <Cut shown={text()!.cut} />
                                </div>
                            </Match>
                            <Match when={true}>
                                <div class={styles.code}>
                                    <PaperCode
                                        block
                                        class={styles.codeBlock}
                                        language={local.language ?? (kind() === "code" ? previewLanguage(local.name) : "text")}
                                    >
                                        {text()!.text}
                                    </PaperCode>
                                    <Cut shown={text()!.cut} />
                                </div>
                            </Match>
                        </Switch>
                    </div>
                </>
            )}
        />
    );
}

function Cut(props: { shown: boolean }) {
    return (
        <Show when={props.shown}>
            <PaperText size={2} color="text-subtle">
                Showing the first {PAPER_PREVIEW_TEXT_BYTES / 1024 / 1024} MB.
            </PaperText>
        </Show>
    );
}
