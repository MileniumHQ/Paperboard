import styles from "./index.module.css";
import { createSignal, Match, onMount, Show, splitProps, Switch, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperEmptyState } from "../PaperEmptyState";
import { PaperLoader } from "../PaperLoader";
import { previewHost } from "../../templates/PaperPreview/controls";
import { cx } from "../../utils/cx";
import type { PdfDocumentProps, PdfViewerFailure } from "./PdfDocument";

export interface PaperPdfProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onError"> {
    /** URL of the PDF; blob: URLs work. A new one replaces the document. */
    src: string;
    /** Accessible name for the viewer. Defaults to "PDF". */
    label?: string;
    /** Called with the message the viewer shows when the PDF or a page can't be shown. */
    onError?: (message: string) => void;
    /** Zoom buttons and the page number over the pages. Defaults to true. */
    controls?: boolean;
}

// pdf.js is most of a megabyte: the viewer, and pdf.js with it, load the
// first time a PDF is shown. A failed load is forgotten, so Retry loads again.
type Viewer = (props: PdfDocumentProps) => JSX.Element;
let viewer: Promise<Viewer> | null = null;
function loadViewer(): Promise<Viewer> {
    viewer ??= import("./PdfDocument").then(
        (module) => module.PdfDocument,
        (err: unknown) => {
            viewer = null;
            throw err;
        },
    );
    return viewer;
}

type State = { status: "loading" } | { status: "ready" } | ({ status: "failed" } & PdfViewerFailure);

/**
 * A PDF viewer that fills its container: pages in one scrolling column,
 * fitted to the width, with selectable text, zoom and a page number.
 */
export function PaperPdf(props: PaperPdfProps) {
    const [local, rest] = splitProps(props, ["src", "label", "onError", "controls", "class", "classList"]);
    const [View, setView] = createSignal<Viewer>();
    const [state, setState] = createSignal<State>({ status: "loading" });

    const fail = (failure: PdfViewerFailure) => {
        setState({ status: "failed", ...failure });
        local.onError?.(failure.message);
    };

    const start = () => {
        setState({ status: "loading" });
        loadViewer().then(
            (component) => setView(() => component),
            () => fail({ message: "Can't load the PDF viewer", retry: start }),
        );
    };
    // in the browser only: a server render shows the loader
    onMount(start);

    const failure = () => {
        const current = state();
        return current.status === "failed" ? current : undefined;
    };

    return (
        <div
            role="group"
            aria-label={local.label ?? "PDF"}
            {...rest}
            class={cx(styles.PaperPdf, previewHost, local.class)}
            classList={local.classList}
            aria-busy={state().status === "loading"}
        >
            <Show when={View()}>
                {(component) => (
                    <Dynamic
                        component={component()}
                        src={local.src}
                        controls={local.controls ?? true}
                        onLoading={() => setState({ status: "loading" })}
                        onReady={() => setState({ status: "ready" })}
                        onFail={fail}
                        onPageError={(message: string) => local.onError?.(message)}
                    />
                )}
            </Show>
            <Switch>
                <Match when={state().status === "loading"}>
                    <PaperLoader class={styles.overlay} loaderStatus="indeterminate" delay={150} />
                </Match>
                <Match when={failure()}>
                    {(shown) => (
                        <PaperEmptyState class={styles.overlay} icon="error" role="alert" title={shown().message}>
                            <Show when={shown().retry}>
                                {(retry) => (
                                    <PaperButton size="small" onClick={() => retry()()}>
                                        Retry
                                    </PaperButton>
                                )}
                            </Show>
                        </PaperEmptyState>
                    )}
                </Match>
            </Switch>
        </div>
    );
}

/**
 * Draws page 1 of the PDF at `src` as a PNG whose longer edge is `size`
 * pixels. Rejects with the reason PaperPdf would show, such as "This PDF is
 * password-protected", or with `signal`'s reason once it aborts. Loads
 * pdf.js on first use, like PaperPdf.
 */
export async function renderPdfThumbnail(src: string, size: number, signal?: AbortSignal): Promise<Blob> {
    const { renderPdfThumbnail: render } = await import("./thumbnail");
    return render(src, size, signal);
}
