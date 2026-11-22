import styles from "./PaperPreviewModal.module.css";
import { createMemo, splitProps, type JSX } from "solid-js";
import { ModalLayer } from "../../components/PaperModal/layer";
import { PaperButton } from "../../components/PaperButton";
import { PaperIcon } from "../../components/PaperIcon";
import { prefersNativeVideo } from "../../components/PaperVideo";
import { cx } from "../../utils/cx";
import { previewKind } from "./kinds";
import { PaperPreview, type PaperPreviewFile } from "./PaperPreview";

export interface PaperPreviewModalProps extends PaperPreviewFile, Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "onError"> {
    open?: boolean;
    onClose?: () => void;
    /** More buttons beside Close, like a Save. */
    actions?: JSX.Element;
    /** Called with what went wrong when the file can't be read or drawn; it is also shown in place. */
    onError?: (message: string) => void;
}

/**
 * A file, shown over the page the way PaperModal shows a dialog, rising in
 * as one does: PaperPreview picks its viewer, and its name, its actions and
 * Close sit above it. A press on the space around the file closes it, as the
 * scrim's does. On a phone or tablet, a video goes straight to the system's
 * own player, and leaving that closes the preview.
 */
export function PaperPreviewModal(props: PaperPreviewModalProps) {
    const [local, file, rest] = splitProps(
        props,
        ["open", "onClose", "actions", "onError", "class"],
        ["src", "name", "type", "kind", "language", "size", "error"],
    );
    // the file as it was while open: a host that clears it as the preview
    // closes would otherwise swap the viewer for an empty card during the fade
    const shown = createMemo<PaperPreviewFile>(
        (last) =>
            local.open
                ? { src: file.src, name: file.name, type: file.type, kind: file.kind, language: file.language, size: file.size, error: file.error }
                : last,
        { name: "" },
    );
    const kind = () => {
        const f = shown();
        return f.kind !== undefined ? f.kind : previewKind(f.name, f.type);
    };

    // a press that starts and ends on the space around the file closes it; a
    // text selection dragged out of a sheet ends there too, and must not
    let pressedOn: EventTarget | null = null;
    const notePress = (e: PointerEvent) => (pressedOn = e.target);
    const closeOnSpace = (e: MouseEvent) => {
        if (e.target === e.currentTarget && pressedOn === e.currentTarget) local.onClose?.();
    };

    return (
        <ModalLayer
            open={local.open}
            onClose={local.onClose}
            aria-label={shown().name}
            {...rest}
            class={cx(styles.PaperPreviewModal, local.class)}
            data-kind={shown().error ? "error" : (kind() ?? "file")}
            onPointerDown={notePress}
            onClick={closeOnSpace}
            content={() => (
                <>
                    <div class={styles.top} onClick={closeOnSpace}>
                        <span class={styles.name} title={shown().name}>
                            {shown().name}
                        </span>
                        <div class={styles.actions}>
                            {local.actions}
                            <PaperButton size="small" onClick={() => local.onClose?.()}>
                                <PaperIcon zeroHeight>close</PaperIcon>
                                Close
                            </PaperButton>
                        </div>
                    </div>
                    <PaperPreview
                        class={styles.preview}
                        src={shown().src}
                        name={shown().name}
                        type={shown().type}
                        kind={shown().kind}
                        language={shown().language}
                        size={shown().size}
                        error={shown().error}
                        onError={(message) => local.onError?.(message)}
                        nativeVideo={prefersNativeVideo()}
                        onNativeVideoClose={() => local.onClose?.()}
                        onClick={closeOnSpace}
                    />
                </>
            )}
        />
    );
}
