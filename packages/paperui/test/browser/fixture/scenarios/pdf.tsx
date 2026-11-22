// PaperPdf and renderPdfThumbnail, driven from window.t.
import { createSignal, type JSX } from "solid-js";
import { PaperPdf, PaperProvider, renderPdfThumbnail } from "@mileniumhq/paperui";

const query = new URLSearchParams(location.search);
const shell = (content: () => JSX.Element) => (
    <PaperProvider fullScreen theme={query.get("theme") === "dark" ? "dark" : "light"}>
        {content()}
    </PaperProvider>
);

/**
 * A PDF of `count` letter pages, each titled "Page n", as a blob: URL: big
 * documents without a big fixture file.
 */
function makePdf(count: number): string {
    const objects: string[] = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${count} >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    for (let i = 0; i < count; i++) {
        const content = `BT /F1 36 Tf 72 680 Td (Page ${i + 1}) Tj ET`;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
}

/** what a PNG blob decodes to, for a test to read */
async function measure(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const size = { type: blob.type, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}

export const scenarios: Record<string, () => JSX.Element> = {
    pdf() {
        const [src, setSrc] = createSignal(query.get("src") ?? "/files/pdf-sample.pdf");
        window.t = {
            errors: [] as string[],
            setSrc,
            makePdf,
            async thumbnail(url: string, size: number) {
                return measure(await renderPdfThumbnail(url, size));
            },
            /** a thumbnail aborted while it renders: what it rejects with */
            async abortedThumbnail(url: string) {
                const controller = new AbortController();
                const pending = renderPdfThumbnail(url, 200, controller.signal);
                controller.abort(new DOMException("stopped", "AbortError"));
                return pending.then(
                    () => "resolved",
                    (err: unknown) => (err instanceof DOMException ? err.name : String(err)),
                );
            },
            async thumbnailError(url: string) {
                return renderPdfThumbnail(url, 200).then(
                    () => "resolved",
                    (err: unknown) => (err instanceof Error ? err.message : String(err)),
                );
            },
        };
        const width = query.get("width") ?? "800";
        const height = query.get("height") ?? "600";
        return shell(() => (
            <div style={{ width: `${width}px`, height: `${height}px` }}>
                <PaperPdf src={src()} label="Sample" onError={(message) => window.t.errors.push(message)} />
            </div>
        ));
    },
};
