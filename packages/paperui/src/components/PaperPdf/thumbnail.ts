import { describePdfError, openPdf, pdfWorker } from "./pdfjs";

/**
 * Draws page 1 of the PDF at `src` with its longer edge `size` pixels long,
 * as a PNG. Rejects with the reason PaperPdf would show ("This PDF is
 * password-protected"), or with `signal`'s reason once it aborts.
 */
export async function renderPdfThumbnail(src: string, size: number, signal?: AbortSignal): Promise<Blob> {
    if (!Number.isFinite(size) || size < 1) throw new RangeError(`A PDF thumbnail needs a size of at least 1 pixel, not ${size}`);
    signal?.throwIfAborted();
    const thread = await pdfWorker();
    signal?.throwIfAborted();
    const task = openPdf(src, thread);
    let stop: () => void = () => void task.destroy();
    const onAbort = () => stop();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const doc = await task.promise;
        signal?.throwIfAborted();
        const page = await doc.getPage(1);
        signal?.throwIfAborted();
        const base = page.getViewport({ scale: 1 });
        const scale = size / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const render = page.render({
            canvas,
            viewport,
            transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
        });
        stop = () => render.cancel();
        await render.promise;
        signal?.throwIfAborted();
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        canvas.width = canvas.height = 0;
        if (png) return png;
        throw new Error("the canvas gave no PNG");
    } catch (err) {
        if (signal?.aborted) throw signal.reason;
        throw new Error(describePdfError(err).message, { cause: err });
    } finally {
        signal?.removeEventListener("abort", onAbort);
        // quiet: closing a document that failed to open can itself reject; the failure was already thrown
        await task.destroy().catch(() => {});
    }
}
