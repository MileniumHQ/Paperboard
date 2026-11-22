import { onCleanup } from "solid-js";
import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperKbd,
    PaperLink,
    PaperPdf,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

// The demo's PDF is written in the page, so it needs no file from the
// network: three letter pages of Helvetica text.
function samplePdf(): string {
    const pages = [
        ["Document", "Text on this page can be selected and copied.", "Page 1 of 3"],
        ["Second page", "Pages scroll in one column, fitted to the width.", "Page 2 of 3"],
        ["Third page", "Zoom with the buttons, or with Ctrl and the wheel.", "Page 3 of 3"],
    ];
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    pages.forEach((lines, i) => {
        const content = lines.map((line, j) => `BT /F1 ${j === 0 ? 32 : 14} Tf 72 ${700 - j * 40} Td (${line}) Tj ET`).join("\n");
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    let body = "%PDF-1.4\n";
    const offsets = objects.map((object, i) => {
        const offset = body.length;
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
}

export default function PaperPdfDoc() {
    const sample = typeof document === "undefined" ? "" : samplePdf();
    onCleanup(() => sample && URL.revokeObjectURL(sample));

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPdf</PaperText>
            <PaperText preset="body" as="p">
                PaperPdf shows a PDF's pages in one scrolling column that fills its parent.
                Use it when a panel shows a document: an invoice, a manual, a report, or a file the user picked.
                Text can be selected and copied, and the pages zoom from the buttons, the keys, a pinch, or <PaperKbd>Ctrl</PaperKbd> with the wheel.{" "}
                <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink> shows PDFs with it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the PDF's URL in <PaperCode>src</PaperCode>, and give the viewer a parent with a height.
                It fills that parent, and with no height from it, it keeps the <PaperCode>panel-height-small</PaperCode> size.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex height="panel-height-large" fullWidth>
                    <PaperPdf src={sample} label="Document" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperPdf } from "@mileniumhq/paperui";

export function Example(props: { url: string }) {
    return (
        <PaperFlex height="panel-height-large" fullWidth>
            <PaperPdf src={props.url} label="Document" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPdfProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> except <PaperCode>onError</PaperCode>, which has a different signature.
                Every other prop lands on the root <PaperCode>div</PaperCode>, after its <PaperCode>role="group"</PaperCode> and <PaperCode>aria-label</PaperCode>, so you can override both.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>URL of the PDF, <PaperCode>blob:</PaperCode> URLs included. A new URL closes the shown document and opens the new one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"PDF"</PaperCode></td>
                        <td>Accessible name of the viewer.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>controls</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows the zoom buttons and the page number in a bar over the bottom of the pages.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with the message the viewer shows when the PDF or one of its pages can't be shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid class props</td>
                        <td>No default</td>
                        <td>Added to the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="thumbnails">Thumbnails</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>renderPdfThumbnail</PaperCode> draws a PDF's first page as a PNG, for a file grid or a list.
            </PaperText>
            <PaperCode block language="tsx">
{`import { renderPdfThumbnail } from "@mileniumhq/paperui";

renderPdfThumbnail(src: string, size: number, signal?: AbortSignal): Promise<Blob>;`}
            </PaperCode>
            <PaperTextList>
                <li>The PNG's longer edge is <PaperCode>size</PaperCode> pixels, and the other edge keeps the page's shape.</li>
                <li>It rejects with the message PaperPdf would show for the file, such as <PaperCode>This PDF is password-protected</PaperCode>.</li>
                <li>Aborting <PaperCode>signal</PaperCode> stops the drawing and rejects with the signal's reason.</li>
                <li>The document is closed once the PNG is made.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="loading">Loading</PaperText>
            <PaperTextList>
                <li>PDF.js, the engine that reads PDFs, loads the first time a PDF is shown, so pages without one never download it.</li>
                <li>Documents are read on a worker thread. A slow document never stops the page from scrolling or taking input.</li>
                <li>A loader appears when opening takes longer than 150 ms.</li>
                <li>Every page is laid out at its own size as soon as the document opens, so the scrollbar is right from the start. Pages are drawn as they come near the view, and pages far from it are let go, so a document of hundreds of pages opens at once and keeps drawings only for the pages within three screens of the view.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="zoom">Zoom</PaperText>
            <PaperTextList>
                <li>A document opens fitted to the width of its widest page among the first 50.</li>
                <li>The zoom runs from 25% to 500%, and the readout shows it, where 100% is the page's printed size.</li>
                <li>The minus and plus buttons step through 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, and 500%. The fit button returns to the fitted width, which follows the viewer's size.</li>
                <li>A pinch, or <PaperKbd>Ctrl</PaperKbd> or <PaperKbd>Cmd</PaperKbd> with the wheel, zooms around the pointer. The pages follow every frame and are drawn sharp once the gesture rests.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="keyboard">Keyboard and accessibility</PaperText>
            <PaperTextList>
                <li>The pages take focus. <PaperKbd>Page Down</PaperKbd> and <PaperKbd>Page Up</PaperKbd> go to the next and previous page, <PaperKbd>Home</PaperKbd> and <PaperKbd>End</PaperKbd> to the first and last, and the arrows and <PaperKbd>Space</PaperKbd> scroll.</li>
                <li><PaperKbd>+</PaperKbd> and <PaperKbd>-</PaperKbd> zoom in and out, and <PaperKbd>0</PaperKbd> fits the width.</li>
                <li>The page number reads <PaperCode>3 / 12</PaperCode> and follows the page in the middle of the view.</li>
                <li>Each page's text lies over it, unseen, so it can be selected, copied, and read by assistive technology.</li>
                <li>Where a pointer can hover, the controls rest faded until the viewer is hovered or one of them has focus.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="security">Security</PaperText>
            <PaperText preset="body" as="p">
                A PDF is treated as untrusted.
                Its JavaScript never runs, XFA forms are off, and links in it are not followed.
                The viewer fetches nothing a document names: the only requests are for <PaperCode>src</PaperCode> and for the fonts, character maps, and image decoders PaperUI ships next to its own files.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                When the document can't be shown, the pages are replaced by the message in an element with <PaperCode>role="alert"</PaperCode>, with a <PaperCode>Retry</PaperCode> button where trying again can help.
                A page that can't be drawn shows the message in its place, and the rest of the document still shows.{" "}
                <PaperCode>onError</PaperCode> receives each message.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Message</th>
                        <th>Cause</th>
                        <th>Retry</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>This PDF is password-protected</PaperCode></td>
                        <td>The document needs a password to open.</td>
                        <td>No</td>
                    </tr>
                    <tr>
                        <td><PaperCode>This PDF is damaged</PaperCode></td>
                        <td>The file is not a PDF, or its structure can't be read.</td>
                        <td>No</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't load PDF</PaperCode></td>
                        <td>The server answered with an error, such as a 404.</td>
                        <td>Yes</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't load the PDF viewer</PaperCode></td>
                        <td>The viewer's own code failed to download.</td>
                        <td>Yes</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PDF unavailable</PaperCode></td>
                        <td>Any other failure, such as a refused connection.</td>
                        <td>Yes</td>
                    </tr>
                    <tr>
                        <td><PaperCode>Can't show page 3</PaperCode></td>
                        <td>One page failed to draw. Only that page shows the message.</td>
                        <td>No</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="picked-file">Show a file the user picked</PaperText>
            <PaperText preset="body" as="p">
                Turn the file into a <PaperCode>blob:</PaperCode> URL, and revoke it when the viewer no longer needs it.
            </PaperText>
            <PaperCode block language="tsx">
{`import { onCleanup } from "solid-js";
import { PaperFlex, PaperPdf } from "@mileniumhq/paperui";

export function PickedPdf(props: { file: File }) {
    const url = URL.createObjectURL(props.file);
    onCleanup(() => URL.revokeObjectURL(url));
    return (
        <PaperFlex height="panel-height-large" fullWidth>
            <PaperPdf src={url} label={props.file.name} />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="report-errors">Report errors</PaperText>
            <PaperText preset="body" as="p">
                The viewer already shows the failure.
                Use <PaperCode>onError</PaperCode> to record it elsewhere.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperPdf } from "@mileniumhq/paperui";

export function Invoice(props: { url: string; onFailure: (message: string) => void }) {
    return (
        <PaperFlex height="panel-height-large" fullWidth>
            <PaperPdf src={props.url} label="Invoice" onError={props.onFailure} />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="thumbnail-example">Draw a thumbnail</PaperText>
            <PaperText preset="body" as="p">
                Abort the drawing when the thumbnail leaves the page, and show the failure in its place.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createResource, onCleanup, Show } from "solid-js";
import { PaperIcon, renderPdfThumbnail } from "@mileniumhq/paperui";

export function PdfThumbnail(props: { url: string }) {
    const controller = new AbortController();
    const [png] = createResource(async () => URL.createObjectURL(await renderPdfThumbnail(props.url, 160, controller.signal)));
    onCleanup(() => {
        controller.abort();
        if (png.state === "ready") URL.revokeObjectURL(png());
    });
    return (
        <Show when={png.state !== "errored"} fallback={<PaperIcon label={png.error.message}>error</PaperIcon>}>
            <Show when={png.state === "ready" && png()}>{(url) => <img src={url()} alt="First page" />}</Show>
        </Show>
    );
}}`}
            </PaperCode>
        </PaperFlex>
    );
}
