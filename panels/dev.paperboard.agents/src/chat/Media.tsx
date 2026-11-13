// Files in the conversation, shown: images, video and audio play where they
// are, markdown, code and text are cards, and every one of them opens in a
// PaperPreview. Anything a preview can't show is a card that saves it.
// Agent messages show files through markdown: `![caption](attachment:<id>)`
// on its own line, or `[name](attachment:<id>)` in a sentence, a chip that
// opens it. They can show web images and YouTube thumbnails the same way. A
// web image comes through the service (webImage.ts), which fetches it under the
// agent's network rule: a message, written by the model or by a page it read,
// never gets this page to ask a host of its choosing for anything.

import { createContext, createResource, createSignal, For, Match, Switch, useContext, type JSX, type ParentProps } from "solid-js";
import {
    PaperAudio,
    PaperButton,
    PaperIcon,
    PaperInlineChip,
    PaperLink,
    PaperPreview,
    PaperVideo,
    previewKind,
    type MarkdownImage,
    type MarkdownLink,
} from "@mileniumhq/paperui";
import { ATTACHMENT_ID, ATTACHMENT_SCHEME, type Attachment } from "../contract";
import type { Files } from "../lib/files";
import { sizeText } from "../lib/files";
import { youTubeId } from "../lib/youtube";
import styles from "./Media.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The icon for a file, by how it shows. */
function iconFor(file: Attachment): string {
    switch (file.kind === "file" ? previewKind(file.name, file.type) : file.kind) {
        case "image":
            return "image";
        case "video":
            return "movie";
        case "audio":
            return "music_note";
        case "markdown":
            return "article";
        case "code":
            return "code";
        case "text":
            return "description";
        default:
            return "draft";
    }
}

const previewable = (file: Attachment) => previewKind(file.name, file.type) !== null;

interface Media {
    files: Files;
    /** Show a file in the chat's preview. */
    open(id: string, name: string): void;
    /** Save a file to the user's computer; throws when it can't be read. */
    save(id: string): Promise<void>;
}

const MediaContext = createContext<Media>();

function useMedia(): Media {
    const media = useContext(MediaContext);
    if (!media) throw new Error("a file is shown outside the chat's MediaProvider");
    return media;
}

async function saveFile(files: Files, id: string) {
    const read = await files.read(id);
    const link = document.createElement("a");
    link.href = read.url;
    link.download = read.file.name;
    link.click();
}

/** The chat's files and its one preview: everything under it shows files and opens them there. */
export function MediaProvider(props: ParentProps<{ files: Files }>) {
    const [shown, setShown] = createSignal<{ id: string; name: string } | null>(null);
    const [read] = createResource(
        () => shown()?.id,
        (id) => props.files.read(id),
    );
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const media: Media = {
        files: props.files,
        open: (id, name) => {
            setSaveError(null);
            setShown({ id, name });
        },
        save: (id) => saveFile(props.files, id),
    };
    const file = () => (read.loading || read.error ? undefined : read());

    return (
        <MediaContext.Provider value={media}>
            {props.children}
            <PaperPreview
                open={shown() !== null}
                onClose={() => setShown(null)}
                name={file()?.file.name ?? shown()?.name ?? ""}
                type={file()?.file.type}
                src={file()?.url}
                error={read.error ? `${shown()?.name ?? "The file"} couldn't be read: ${message(read.error)}` : (saveError() ?? undefined)}
                actions={
                    <PaperButton
                        size="small"
                        disabled={!file()}
                        onClick={() => {
                            const f = file();
                            if (f) media.save(f.file.id).catch((e) => setSaveError(`${f.file.name} couldn't be saved: ${message(e)}`));
                        }}
                    >
                        <PaperIcon zeroHeight>download</PaperIcon>
                        Save
                    </PaperButton>
                }
            />
        </MediaContext.Provider>
    );
}

/** A card that names a file: it opens the file when a preview can show it, and saves it when not. */
function FileCard(props: { file: Attachment }) {
    const media = useMedia();
    const [failed, setFailed] = createSignal<string | null>(null);
    const canPreview = () => previewable(props.file);
    const press = () => {
        setFailed(null);
        if (canPreview()) media.open(props.file.id, props.file.name);
        else media.save(props.file.id).catch((e) => setFailed(message(e)));
    };
    return (
        <button
            type="button"
            class={styles.file}
            onClick={press}
            title={failed() ? `${props.file.name} couldn't be saved: ${failed()}` : `${canPreview() ? "Open" : "Save"} ${props.file.name}`}
        >
            <PaperIcon class={failed() ? styles.failed : undefined}>{failed() ? "error" : iconFor(props.file)}</PaperIcon>
            <span class={styles.fileName}>{props.file.name}</span>
            <span class={styles.fileSize} classList={{ [styles.failed!]: !!failed() }}>
                {failed() ? "Couldn't save" : canPreview() ? sizeText(props.file.bytes) : `Save · ${sizeText(props.file.bytes)}`}
            </span>
        </button>
    );
}

/** A picture, video or recording, read from the service and played where it is. */
function PlayedFile(props: { file: Attachment; caption?: string }) {
    const media = useMedia();
    const [read] = createResource(
        () => props.file,
        (file) => media.files.read(file.id, file.bytes),
    );
    const name = () => props.caption || props.file.name;
    return (
        <Switch>
            <Match when={read.error}>
                <Missing caption={name()} why={message(read.error)} />
            </Match>
            <Match when={read.loading || !read()}>
                <span class={styles.loading} classList={{ [styles.loadingAudio!]: props.file.kind === "audio" }} aria-label={`Loading ${name()}`} />
            </Match>
            <Match when={props.file.kind === "image"}>
                <button type="button" class={styles.mediaButton} onClick={() => media.open(props.file.id, props.file.name)} aria-label={`Open ${name()}`}>
                    <img class={styles.media} src={read()!.url} alt={name()} title={props.file.name} />
                </button>
            </Match>
            <Match when={props.file.kind === "video"}>
                <PaperVideo class={styles.video} src={read()!.url} label={name()} />
            </Match>
            <Match when={props.file.kind === "audio"}>
                <PaperAudio class={styles.audio} src={read()!.url} label={name()} />
            </Match>
        </Switch>
    );
}

function Missing(props: { caption: string; why: string }) {
    return (
        <span class={styles.missing} role="img" aria-label={`${props.caption} couldn't be shown: ${props.why}`} title={props.why}>
            <PaperIcon>broken_image</PaperIcon> {props.caption} couldn't be shown: {props.why}
        </span>
    );
}

/** A picture on the web, as the service fetched it; why not, when it couldn't or wouldn't. */
function WebImage(props: { url: string; alt: string; title?: string }) {
    const media = useMedia();
    const [read] = createResource(
        () => props.url,
        (url) => media.files.webImage(url),
    );
    const name = () => props.alt || "A picture";
    return (
        <Switch>
            <Match when={read.error}>
                <Missing caption={name()} why={message(read.error)} />
            </Match>
            <Match when={read.loading || !read()}>
                <span class={styles.loading} aria-label={`Loading ${name()}`} />
            </Match>
            <Match when={true}>
                <img class={styles.media} src={read()!} alt={props.alt} title={props.title} />
            </Match>
        </Switch>
    );
}

/** A file of the conversation, by id: looked up from the service, then shown for what it is. */
export function FileView(props: { id: string; caption?: string }) {
    const media = useMedia();
    const [info] = createResource(
        () => props.id,
        (id) => media.files.info(id),
    );
    return (
        <Switch>
            <Match when={info.error}>
                <Missing caption={props.caption || "A file"} why={message(info.error)} />
            </Match>
            <Match when={info.loading || !info()}>
                <span class={styles.loading} aria-label={`Loading ${props.caption || "a file"}`} />
            </Match>
            <Match when={info()!.kind !== "file"}>
                <PlayedFile file={info()!} caption={props.caption} />
            </Match>
            <Match when={true}>
                <FileCard file={info()!} />
            </Match>
        </Switch>
    );
}

/** A file named in a sentence: a chip with its icon and name that opens it. */
export function FileChip(props: { id: string; label: string }) {
    const media = useMedia();
    const [info] = createResource(
        () => props.id,
        (id) => media.files.info(id),
    );
    const [failed, setFailed] = createSignal<string | null>(null);
    // a resource read while it's failed throws: the chip shows the failure instead
    const file = () => (info.state === "ready" ? info() : undefined);
    const label = () => props.label.trim() || file()?.name || "A file";
    const problem = () => failed() ?? (info.error ? `${label()} couldn't be found: ${message(info.error)}` : null);
    const press = () => {
        const file = info.state === "ready" ? info() : undefined;
        if (!file) return;
        setFailed(null);
        if (previewable(file)) media.open(file.id, file.name);
        else media.save(file.id).catch((e) => setFailed(`${file.name} couldn't be saved: ${message(e)}`));
    };
    return (
        <PaperInlineChip
            icon={problem() ? "error" : file() ? iconFor(file()!) : "draft"}
            disabled={!file()}
            title={problem() ?? (file() ? `${previewable(file()!) ? "Open" : "Save"} ${file()!.name}` : undefined)}
            aria-label={problem() ?? undefined}
            onClick={press}
        >
            {label()}
        </PaperInlineChip>
    );
}

/** The files a message carries, under its text. */
export function AttachmentList(props: { list: Attachment[]; class?: string }) {
    return (
        <div class={`${styles.list} ${props.class ?? ""}`}>
            <For each={props.list}>{(a) => <FileView id={a.id} caption={a.name} />}</For>
        </div>
    );
}

/**
 * The markdown extension for agent messages: the conversation's files, YouTube thumbnails and web images.
 * Anything else falls back to PaperMarkdown's own rendering (its alt text: other schemes aren't shown).
 */
export function renderAgentImage(img: MarkdownImage): JSX.Element | undefined {
    if (img.src.startsWith(ATTACHMENT_SCHEME)) {
        const id = img.src.slice(ATTACHMENT_SCHEME.length);
        return ATTACHMENT_ID.test(id) ? <FileView id={id} caption={img.alt} /> : undefined;
    }
    const video = youTubeId(img.src);
    if (video) {
        return (
            <PaperLink href={`https://www.youtube.com/watch?v=${video}`} class={styles.youtube} title={img.alt || "Watch on YouTube"}>
                <img class={styles.media} src={`https://i.ytimg.com/vi/${video}/hqdefault.jpg`} alt={img.alt || "A YouTube video"} />
                <span class={styles.play} aria-hidden="true">
                    <PaperIcon>play_arrow</PaperIcon>
                </span>
            </PaperLink>
        );
    }
    if (/^https:\/\//i.test(img.src)) return <WebImage url={img.src} alt={img.alt} title={img.title ?? undefined} />;
    return undefined;
}

/** The markdown extension for agent links: `[name](attachment:<id>)` is a chip that opens the file. */
export function renderAgentLink(link: MarkdownLink): JSX.Element | undefined {
    if (!link.href.startsWith(ATTACHMENT_SCHEME)) return undefined;
    const id = link.href.slice(ATTACHMENT_SCHEME.length);
    // an id that isn't one shows as the link's text, as any link PaperMarkdown refuses does
    return ATTACHMENT_ID.test(id) ? <FileChip id={id} label={link.text} /> : link.children();
}
