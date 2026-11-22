import styles from "./PaperPreview.module.css";
import { Match, splitProps, Switch, type JSX } from "solid-js";
import { PaperAudio } from "../../components/PaperAudio";
import { PaperLoader } from "../../components/PaperLoader";
import { PaperModel } from "../../components/PaperModel";
import { PaperPdf } from "../../components/PaperPdf";
import { PaperVideo } from "../../components/PaperVideo";
import { cx } from "../../utils/cx";
import { previewKind, previewModelFormat, type PaperPreviewKind } from "./kinds";
import { Failure } from "./viewers/Failure";
import { FileCard } from "./viewers/FileCard";
import { FontView } from "./viewers/FontView";
import { ImageView } from "./viewers/ImageView";
import { TableView } from "./viewers/TableView";
import { TextView } from "./viewers/TextView";

/** The file a preview shows: shared by PaperPreview and PaperPreviewModal. */
export interface PaperPreviewFile {
    /** The file's address. Until it's set, the preview shows it loading. */
    src?: string;
    /** The file's name: shown on it, and how its kind is told when the type doesn't say. */
    name: string;
    /** Its media type, which is trusted before the name. */
    type?: string;
    /** How to show it, when the type and name don't say; null shows it as a card. */
    kind?: PaperPreviewKind | null;
    /** The language of code, when its name doesn't say. */
    language?: string;
    /** Its size in bytes, shown on the card of a file there is no viewer for. */
    size?: number;
    /** Why the file can't be shown, such as a failed download: drawn in place of it. */
    error?: string;
}

export interface PaperPreviewProps extends PaperPreviewFile, Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    /** The viewer's own controls (zoom, pages, view), floating at its bottom edge. On by default. */
    controls?: boolean;
    /** Called with what went wrong when the file can't be read or drawn; it is also shown in place. */
    onError?: (message: string) => void;
    /** Buttons on the card of a file there is no viewer for, such as a Save. */
    cardActions?: JSX.Element;
    /** On a phone or tablet, hand video straight to the system's player, as PaperPreviewModal does. */
    nativeVideo?: boolean;
    /** Called when the system's video player closes, after `nativeVideo` opened it. */
    onNativeVideoClose?: () => void;
}

/**
 * A file, shown with the viewer that suits it, in whatever space it's given:
 * a picture that zooms and pans, a PDF's pages, a 3D model to turn, video and
 * audio players, markdown on a page, highlighted code, a spreadsheet as a
 * table, a font's specimen, and a card for anything else. It picks the viewer
 * from the file's type and name, loads only that one, and shows its loading
 * and its failures in place. PaperPreviewModal shows it over the page.
 */
export function PaperPreview(props: PaperPreviewProps) {
    const [local, rest] = splitProps(props, [
        "src",
        "name",
        "type",
        "kind",
        "language",
        "size",
        "error",
        "controls",
        "onError",
        "cardActions",
        "nativeVideo",
        "onNativeVideoClose",
        "class",
    ]);
    const kind = () => (local.kind !== undefined ? local.kind : previewKind(local.name, local.type));
    const controls = () => local.controls ?? true;
    const report = (message: string) => local.onError?.(message);
    const src = () => local.src!;

    return (
        <div {...rest} class={cx(styles.PaperPreview, local.class)} data-kind={kind() ?? "file"}>
            <Switch>
                <Match when={local.error}>
                    <Failure title={local.error!} />
                </Match>
                <Match when={kind() === null}>
                    <FileCard name={local.name} kind={null} size={local.size}>
                        {local.cardActions}
                    </FileCard>
                </Match>
                <Match when={!local.src}>
                    <PaperLoader loaderStatus="indeterminate" delay={150} label={`Loading ${local.name}`} />
                </Match>
                <Match when={kind() === "image"}>
                    <ImageView src={src()} name={local.name} controls={controls()} onError={report} />
                </Match>
                <Match when={kind() === "video"}>
                    <PaperVideo
                        class={styles.video}
                        src={src()}
                        label={local.name}
                        nativePlayer={local.nativeVideo}
                        onNativePlayerClose={() => local.onNativeVideoClose?.()}
                        onError={report}
                    />
                </Match>
                <Match when={kind() === "audio"}>
                    <PaperAudio class={styles.audio} fullWidth src={src()} label={local.name} onError={report} />
                </Match>
                <Match when={kind() === "pdf"}>
                    <PaperPdf class={styles.fill} src={src()} label={local.name} controls={controls()} onError={report} />
                </Match>
                <Match when={kind() === "model"}>
                    <PaperModel
                        class={styles.fill}
                        src={src()}
                        name={local.name}
                        format={previewModelFormat(local.name, local.type) ?? undefined}
                        label={local.name}
                        controls={controls()}
                        onError={report}
                    />
                </Match>
                <Match when={kind() === "table"}>
                    <TableView src={src()} name={local.name} type={local.type} onError={report} />
                </Match>
                <Match when={kind() === "font"}>
                    <FontView src={src()} name={local.name} onError={report} />
                </Match>
                <Match when={kind() === "markdown" || kind() === "code" || kind() === "text"}>
                    <TextView src={src()} name={local.name} kind={kind() as "markdown" | "code" | "text"} language={local.language} onError={report} />
                </Match>
            </Switch>
        </div>
    );
}
