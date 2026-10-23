// Files in the conversation, shown: images and videos inline, anything else
// as a card that saves it. Agent messages show them through markdown
// (`![caption](attachment:<id>)`), and can show web images and YouTube
// thumbnails the same way.

import { For, Match, Switch, createResource, type JSX } from "solid-js";
import { PaperIcon, PaperLink, type MarkdownImage } from "@mileniumhq/paperui";
import { ATTACHMENT_ID, ATTACHMENT_SCHEME, type Attachment } from "../contract";
import type { Files } from "../lib/files";
import { sizeText } from "../lib/files";
import { youTubeId } from "../lib/youtube";
import styles from "./Media.module.css";

/** A file of the conversation, by id: read from the service, then shown for what it is. */
export function FileView(props: { files: Files; id: string; bytes?: number; caption?: string }) {
    const [read] = createResource(
        () => props.id,
        (id) => props.files.read(id, props.bytes),
    );
    return (
        <Switch>
            <Match when={read.error}>
                <span class={styles.missing} role="img" aria-label={`${props.caption || "A file"} couldn't be shown`}>
                    <PaperIcon>broken_image</PaperIcon> {props.caption || "A file"} couldn't be shown
                </span>
            </Match>
            <Match when={read.loading || !read()}>
                <span class={styles.loading} aria-label={`Loading ${props.caption || "a file"}`} />
            </Match>
            <Match when={read()!.file.kind === "image"}>
                <img class={styles.media} src={read()!.url} alt={props.caption || read()!.file.name} title={read()!.file.name} />
            </Match>
            <Match when={read()!.file.kind === "video"}>
                <video class={styles.media} src={read()!.url} controls preload="metadata" aria-label={props.caption || read()!.file.name} />
            </Match>
            <Match when={true}>
                <a class={styles.file} href={read()!.url} download={read()!.file.name} title={`Save ${read()!.file.name}`}>
                    <PaperIcon>description</PaperIcon>
                    <span class={styles.fileName}>{read()!.file.name}</span>
                    <span class={styles.fileSize}>{sizeText(read()!.file.bytes)}</span>
                </a>
            </Match>
        </Switch>
    );
}

/** The files a message carries, under its text. */
export function AttachmentList(props: { files: Files; list: Attachment[]; class?: string }) {
    return (
        <div class={`${styles.list} ${props.class ?? ""}`}>
            <For each={props.list}>{(a) => <FileView files={props.files} id={a.id} bytes={a.bytes} caption={a.name} />}</For>
        </div>
    );
}

/**
 * The markdown extension for agent messages: the conversation's files, YouTube thumbnails and web images.
 * Anything else falls back to PaperMarkdown's own rendering (its alt text: other schemes aren't shown).
 */
export function renderAgentImage(files: Files) {
    return (img: MarkdownImage): JSX.Element | undefined => {
        if (img.src.startsWith(ATTACHMENT_SCHEME)) {
            const id = img.src.slice(ATTACHMENT_SCHEME.length);
            return ATTACHMENT_ID.test(id) ? <FileView files={files} id={id} caption={img.alt} /> : undefined;
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
        if (/^https:\/\//i.test(img.src)) return <img class={styles.media} src={img.src} alt={img.alt} title={img.title ?? undefined} loading="lazy" />;
        return undefined;
    };
}
