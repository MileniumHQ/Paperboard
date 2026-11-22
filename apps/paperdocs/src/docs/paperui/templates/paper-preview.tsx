import { createSignal, onMount } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperPreview,
    PaperPreviewModal,
    PaperPreviewThumbnail,
    PaperSelector,
    PaperSelectorItem,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

/** saves a file the page holds, under its name */
function save(src: string, name: string) {
    const link = document.createElement("a");
    link.href = src;
    link.download = name;
    link.click();
}

// the demo's files are made in the page; a panel passes the address of its own
const samples: { value: string; name: string; type: string; icon: string; src: string }[] = [
    { value: "markdown", name: "release-notes.md", type: "text/markdown", icon: "article", src: "" },
    { value: "code", name: "greet.ts", type: "", icon: "code", src: "" },
    { value: "table", name: "scores.csv", type: "text/csv", icon: "table_view", src: "" },
    { value: "image", name: "sunrise.png", type: "image/png", icon: "image", src: "" },
];

const blobs: Record<string, BlobPart> = {
    markdown: "# Release notes\n\n- Faster startup\n- A new **backup** screen\n\nSee `README.md` for more.\n",
    code: "export function greet(name: string) {\n    return `Hello, ${name}`;\n}\n",
    table: "Player,Score,Time\nAda,1200,3:41\nGrace,980,4:02\nLinus,1105,3:55\nMargaret,1310,3:28\n",
};

for (const sample of samples) {
    if (sample.value !== "image") sample.src = URL.createObjectURL(new Blob([blobs[sample.value]], { type: sample.type || "text/plain" }));
}

// a picture drawn on a canvas, so the demo needs no file from the network
function drawPicture(): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext("2d")!;
    const sky = context.createLinearGradient(0, 0, 0, 400);
    sky.addColorStop(0, "#1c3a6e");
    sky.addColorStop(0.6, "#e8825a");
    sky.addColorStop(1, "#f6c667");
    context.fillStyle = sky;
    context.fillRect(0, 0, 640, 400);
    context.fillStyle = "#fff3c4";
    context.beginPath();
    context.arc(320, 280, 70, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#1b2a3a";
    context.fillRect(0, 300, 640, 100);
    return new Promise((resolve) => canvas.toBlob(resolve));
}

export default function PaperPreviewDoc() {
    const [current, setCurrent] = createSignal("markdown");
    const [open, setOpen] = createSignal(false);
    const [picture, setPicture] = createSignal("");
    onMount(async () => {
        const blob = await drawPicture();
        if (blob) setPicture(URL.createObjectURL(blob));
    });
    const sample = () => {
        const found = samples.find((s) => s.value === current())!;
        return found.value === "image" ? { ...found, src: picture() } : found;
    };
    const all = () => samples.map((s) => (s.value === "image" ? { ...s, src: picture() } : s));

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPreview</PaperText>
            <PaperText preset="body" as="p">
                PaperPreview shows a file with the viewer that suits it, in whatever space its parent gives it: a picture that zooms and pans, a video or a recording in a player, a PDF's pages, a 3D model to turn, Markdown on a page, highlighted code, a spreadsheet as a table, a font's specimen, and a card for anything it cannot show.
                It comes in three forms. <PaperCode>PaperPreview</PaperCode> sits in the page, <PaperCode>PaperPreviewModal</PaperCode> shows the same viewer over the page, and <PaperCode>PaperPreviewThumbnail</PaperCode> is a small picture of the file for a grid or a list.
                Use it for a file the user picked, a file in a folder, or an attachment in a message.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the file's address in <PaperCode>src</PaperCode> and its name in <PaperCode>name</PaperCode>, and give the preview a parent with a height.
                It fills that parent, and with no height from it, it keeps the <PaperCode>panel-height-small</PaperCode> size.
                Pick a sample file to see its viewer.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full" fullWidth>
                    <PaperSelector name="docs-preview-sample" value={current()} onValueChange={setCurrent}>
                        {samples.map((s) => (
                            <PaperSelectorItem value={s.value} icon={s.icon}>{s.name}</PaperSelectorItem>
                        ))}
                    </PaperSelector>
                    <PaperFlex height="panel-height-large" fullWidth>
                        <PaperPreview src={sample().src || undefined} name={sample().name} type={sample().type} />
                    </PaperFlex>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperPreview } from "@mileniumhq/paperui";

const src = URL.createObjectURL(
    new Blob(["# Release notes\\n\\n- Faster startup\\n"], { type: "text/markdown" }),
);

export function Example() {
    return (
        <PaperFlex height="panel-height-large" fullWidth>
            <PaperPreview src={src} name="release-notes.md" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="modal">Over the page</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>PaperPreviewModal</PaperCode> is always mounted and driven by <PaperCode>open</PaperCode>, like <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.
                Keep a boolean signal, set it from the trigger, and clear it in <PaperCode>onClose</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex gap="full">
                    <PaperButton onClick={() => setOpen(true)}>Open {sample().name}</PaperButton>
                </PaperFlex>
                <PaperPreviewModal
                    open={open()}
                    onClose={() => setOpen(false)}
                    src={sample().src || undefined}
                    name={sample().name}
                    type={sample().type}
                    actions={<PaperButton size="small" onClick={() => save(sample().src, sample().name)}>Save</PaperButton>}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal, onMount } from "solid-js";
import { PaperButton, PaperPreviewModal } from "@mileniumhq/paperui";

/** saves a file the page holds, under its name */
function save(src: string, name: string) {
    const link = document.createElement("a");
    link.href = src;
    link.download = name;
    link.click();
}

export function Example(props: { src: string }) {
    const [open, setOpen] = createSignal(false);

    return (
        <>
            <PaperButton onClick={() => setOpen(true)}>Preview</PaperButton>
            <PaperPreviewModal
                open={open()}
                onClose={() => setOpen(false)}
                src={props.src}
                name="release-notes.md"
                actions={<PaperButton size="small" onClick={() => save(props.src, "release-notes.md")}>Save</PaperButton>}
            />
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="thumbnails">Thumbnails</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>PaperPreviewThumbnail</PaperCode> is a box that shows a small picture of a file.
                It is <PaperCode>avatar-size-xlarge</PaperCode> square until the host sizes it with a class.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex gap="full">
                    {all().map((s) => (
                        <PaperPreviewThumbnail src={s.src || undefined} name={s.name} type={s.type} />
                    ))}
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`<PaperPreviewThumbnail src={file.url} name={file.name} type={file.type} />
<PaperPreviewThumbnail class={styles.tile} fit="cover" src={file.url} name={file.name} />`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="kinds">Kinds</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>previewKind(name, type)</PaperCode> decides which viewer shows a file.
                The media type is trusted first, and a generic one such as <PaperCode>application/octet-stream</PaperCode> defers to the name.
                A name with no extension, like <PaperCode>Dockerfile</PaperCode>, counts as its own extension.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Kind</th>
                        <th>Chosen by</th>
                        <th>Shown as</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>image</PaperCode></td>
                        <td><PaperCode>image/*</PaperCode>, or png, jpg, gif, webp, avif, bmp, ico, svg, and similar</td>
                        <td>The picture, which zooms and pans. Pinch, <PaperCode>⌘</PaperCode> or <PaperCode>Ctrl</PaperCode> with the wheel, and the <PaperCode>+</PaperCode> and <PaperCode>−</PaperCode> keys zoom, <PaperCode>0</PaperCode> fits it, and a double-click shows it at actual size. A pill with zoom out, the zoom in percent, zoom in, and Fit floats at its bottom edge. A format a browser cannot draw, such as HEIC, shows as a card.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>video</PaperCode></td>
                        <td><PaperCode>video/*</PaperCode>, or mp4, m4v, webm, mov, ogv</td>
                        <td><PaperLink href="/docs/paperui/papervideo/">PaperVideo</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>audio</PaperCode></td>
                        <td><PaperCode>audio/*</PaperCode>, or mp3, m4a, aac, wav, ogg, opus, flac</td>
                        <td><PaperLink href="/docs/paperui/paperaudio/">PaperAudio</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>pdf</PaperCode></td>
                        <td><PaperCode>application/pdf</PaperCode>, or pdf</td>
                        <td><PaperLink href="/docs/paperui/paperpdf/">PaperPdf</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>model</PaperCode></td>
                        <td>A <PaperCode>model/*</PaperCode> type, or glb, gltf, obj, stl, ply, fbx, 3mf, dae, usdz</td>
                        <td><PaperLink href="/docs/paperui/papermodel/">PaperModel</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>markdown</PaperCode></td>
                        <td><PaperCode>text/markdown</PaperCode>, or md, markdown</td>
                        <td><PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink> on a sheet.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>code</PaperCode></td>
                        <td>A code extension, such as ts, js, json, css, sh, yaml, py, rs, go, html</td>
                        <td><PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>, highlighted when it has a grammar for the language and plain otherwise. The first 1 MB is read.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td>A <PaperCode>text/*</PaperCode> type, <PaperCode>application/json</PaperCode>, or txt, log</td>
                        <td>PaperCode without highlighting. The first 1 MB is read.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>table</PaperCode></td>
                        <td><PaperCode>text/csv</PaperCode>, <PaperCode>text/tab-separated-values</PaperCode>, or csv, tsv</td>
                        <td>A <PaperLink href="/docs/paperui/papertable/">PaperTable</PaperLink> with a sticky header. The first 1,000 rows are shown, and semicolon-separated CSVs are detected.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>font</PaperCode></td>
                        <td><PaperCode>font/*</PaperCode>, or ttf, otf, woff, woff2</td>
                        <td>A specimen: "Aa", the alphabet, and a sentence at several sizes.</td>
                    </tr>
                    <tr>
                        <td>None</td>
                        <td>Anything else, or <PaperCode>kind</PaperCode> set to <PaperCode>null</PaperCode></td>
                        <td>A card with the file's icon and name, and a caption such as <PaperCode>ZIP file · 1.2 KB</PaperCode>. <PaperCode>cardActions</PaperCode> puts buttons on it.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                PDF and 3D models have their own pages, <PaperLink href="/docs/paperui/paperpdf/">PaperPdf</PaperLink> and <PaperLink href="/docs/paperui/papermodel/">PaperModel</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="subheader" as="h3" id="props-preview">PaperPreview</PaperText>
            <PaperText preset="body" as="p">
                PaperPreviewProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>onError</PaperCode>.
                Other props land on the preview's root element.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The file's name. It labels the file, and its extension tells the kind when the type does not.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's address. Until it is set, the preview shows a loader. A viewer loads only once the file is shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's media type, which is trusted before the name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>kind</PaperCode></td>
                        <td><PaperCode>PaperPreviewKind | null</PaperCode></td>
                        <td>From <PaperCode>previewKind(name, type)</PaperCode></td>
                        <td>How to show the file, when its name and type do not say. <PaperCode>null</PaperCode> shows the card.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>From <PaperCode>previewLanguage(name)</PaperCode></td>
                        <td>The language of code, when the name does not say.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td>No default</td>
                        <td>The file's size in bytes, shown on the card of a file with no viewer.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>error</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Why the file cannot be shown, such as a failed download. The preview draws it in place of the file, with <PaperCode>role="alert"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>controls</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows the viewer's own controls (zoom, pages, view) floating at its bottom edge. Keyboard and gesture controls stay on.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called with what went wrong when the file cannot be read or drawn. The preview also shows it in place.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>cardActions</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>Buttons on the card of a file with no viewer, such as a Save.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>nativeVideo</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>On a phone or tablet, hands video straight to the system's player, as PaperPreviewModal does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onNativeVideoClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the system's video player closes after <PaperCode>nativeVideo</PaperCode> opened it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Added to the preview's root element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="props-modal">PaperPreviewModal</PaperText>
            <PaperText preset="body" as="p">
                PaperPreviewModal takes the file props above (<PaperCode>src</PaperCode>, <PaperCode>name</PaperCode>, <PaperCode>type</PaperCode>, <PaperCode>kind</PaperCode>, <PaperCode>language</PaperCode>, <PaperCode>size</PaperCode>, <PaperCode>error</PaperCode>) and <PaperCode>onError</PaperCode>, plus these.
                Other props land on its layer, after its <PaperCode>role="dialog"</PaperCode> and its <PaperCode>aria-label</PaperCode> (the file's name).
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
                        <td><PaperCode>open</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (closed)</td>
                        <td>Shows the preview. A closed preview renders nothing.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onClose</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the preview asks to close: the Close button, a press on the empty space around the file, Escape, or the system Back action. Set <PaperCode>open</PaperCode> to <PaperCode>false</PaperCode> in it, or the preview stays open.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>More buttons, such as a Save, beside Close.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onExited</PaperCode></td>
                        <td><PaperCode>() =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called once a closed preview has left the screen. The preview keeps showing its file while it fades out, so let go of what it shows here, such as revoking a <PaperCode>blob:</PaperCode> URL, not in <PaperCode>onClose</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="props-thumbnail">PaperPreviewThumbnail</PaperText>
            <PaperText preset="body" as="p">
                PaperPreviewThumbnail extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>onError</PaperCode>.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The file's name. It is the picture's alternative text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's address. Until it is set, the thumbnail shows the symbol of the file's kind.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode>, <PaperCode>kind</PaperCode></td>
                        <td><PaperCode>string</PaperCode>, <PaperCode>PaperPreviewKind | null</PaperCode></td>
                        <td>From <PaperCode>previewKind(name, type)</PaperCode></td>
                        <td>As on PaperPreview. A file with no kind shows only its symbol.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fit</PaperCode></td>
                        <td><PaperCode>"contain" | "cover"</PaperCode></td>
                        <td><PaperCode>"contain"</PaperCode></td>
                        <td><PaperCode>"contain"</PaperCode> shows all of the picture. <PaperCode>"cover"</PaperCode> fills the box and crops, as a photo grid does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onError</PaperCode></td>
                        <td><PaperCode>(message: string) =&gt; void</PaperCode></td>
                        <td>No default</td>
                        <td>Called when the file cannot be drawn. The thumbnail shows a broken-image symbol, with the message as its tooltip.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Sizes the box. Its default is <PaperCode>avatar-size-xlarge</PaperCode> square, and the picture is made at the box's size times <PaperCode>devicePixelRatio</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="thumbnail-function">paperPreviewThumbnail</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>paperPreviewThumbnail(file, {"{ size, signal }"})</PaperCode> makes the PNG behind a thumbnail, for a host that draws its own.
                It resolves to a <PaperCode>Blob</PaperCode>, or <PaperCode>null</PaperCode> for a file with no picture, such as an archive.
                It rejects when the file cannot be read or drawn.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>file</PaperCode> is <PaperCode>{"{ src, name, type?, kind? }"}</PaperCode>. <PaperCode>size</PaperCode> is the longer edge in device pixels.</li>
                <li>Results are cached, up to 300, so asking again for the same file and size answers from memory. Identical requests in flight share one job.</li>
                <li>Three thumbnails are made at a time, so a folder of hundreds never stalls the page.</li>
                <li>A job is aborted when every caller's <PaperCode>signal</PaperCode> has aborted.</li>
                <li><PaperCode>clearPaperPreviewThumbnails()</PaperCode> empties the cache, such as after a file's contents change at the same address.</li>
            </PaperTextList>
            <PaperCode block language="tsx">
{`import { paperPreviewThumbnail } from "@mileniumhq/paperui";

const controller = new AbortController();
const blob = await paperPreviewThumbnail(
    { src: file.url, name: file.name, type: file.type },
    { size: 256, signal: controller.signal },
);`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="related">Related exports</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>previewKind(name, type?)</PaperCode></td>
                        <td>The kind a file previews as, or <PaperCode>null</PaperCode> when it shows as a card.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewLanguage(name)</PaperCode></td>
                        <td>The language PaperCode highlights the file in, or <PaperCode>"text"</PaperCode> when it has no grammar.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewIcon(kind)</PaperCode></td>
                        <td>The symbol that stands for a kind. A plain page for <PaperCode>null</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewKindLabel(kind, name?)</PaperCode></td>
                        <td>What a kind is called in a sentence, such as <PaperCode>"PDF document"</PaperCode>. For <PaperCode>null</PaperCode>, the name's extension, such as <PaperCode>"ZIP file"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewModelFormat(name, type?)</PaperCode></td>
                        <td>The 3D format of a file, or <PaperCode>null</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewExtension(name)</PaperCode></td>
                        <td>The name's extension in lowercase. A dotless name is its own extension.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_MODEL_FORMATS</PaperCode></td>
                        <td>The 3D formats PaperModel opens.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_PREVIEW_TEXT_BYTES</PaperCode></td>
                        <td>The most of a text file a preview reads, 1 MB.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_PREVIEW_TABLE_ROWS</PaperCode></td>
                        <td>The most rows of a table a preview shows, 1,000.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parseDelimited(text, delimiter)</PaperCode></td>
                        <td>Splits CSV or TSV text into rows of cells, the way the table viewer does.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperPreviewControls</PaperCode>, <PaperCode>PaperPreviewReadout</PaperCode></td>
                        <td>The floating pill the viewers use, and a number inside it such as <PaperCode>125%</PaperCode>. Use them to give a custom viewer the same controls.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>clearPaperPreviewThumbnails()</PaperCode></td>
                        <td>Empties the thumbnail cache.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="size">Size</PaperText>
            <PaperTextList>
                <li>PaperPreview fills its parent and is a CSS size container, so its viewers lay out by the space they have.</li>
                <li>With no height from its parent, it keeps the <PaperCode>panel-height-small</PaperCode> size.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="loading">Loading and text</PaperText>
            <PaperTextList>
                <li>While <PaperCode>src</PaperCode> is unset, the preview shows a loader. Set it when the address is known, such as after a download finishes.</li>
                <li>Only the first 1 MB of a text file is read. A longer file is cut there, and a note under it says <PaperCode>Showing the first 1 MB.</PaperCode></li>
                <li>A table shows its first 1,000 rows.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperTextList>
                <li>When <PaperCode>error</PaperCode> is set, the preview draws it in place of the file, in an element with <PaperCode>role="alert"</PaperCode>.</li>
                <li>A file that cannot be read or drawn shows what went wrong in place and calls <PaperCode>onError</PaperCode>.</li>
                <li>A video or audio file that fails to play shows the player's own error and Retry.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="modal-behavior">PaperPreviewModal</PaperText>
            <PaperTextList>
                <li>It rises in over the page like a modal, with the name, <PaperCode>actions</PaperCode>, and Close above the file.</li>
                <li>A press on empty space around the file closes it, as the scrim's does.</li>
                <li>On a phone or tablet, a video goes straight to the system's player, and leaving the player closes the preview.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="thumbnail-behavior">PaperPreviewThumbnail</PaperText>
            <PaperTextList>
                <li>The picture is made once the box is near the screen, at its size times <PaperCode>devicePixelRatio</PaperCode>, and shared with every other thumbnail of the same file.</li>
                <li>Until the picture is ready, and for a file with no picture, the box shows the symbol of the file's kind.</li>
                <li>A file that cannot be drawn shows <PaperCode>broken_image</PaperCode> and calls <PaperCode>onError</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="attachment">Preview an attachment</PaperText>
            <PaperText preset="body" as="p">
                Offer a preview for any file, since a file with no viewer shows as a card, and give a Save beside Close with <PaperCode>actions</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, onMount } from "solid-js";
import { PaperButton, PaperPreviewModal } from "@mileniumhq/paperui";

/** saves a file the page holds, under its name */
function save(src: string, name: string) {
    const link = document.createElement("a");
    link.href = src;
    link.download = name;
    link.click();
}

export function Attachment(props: { name: string; type: string; url: string }) {
    const [open, setOpen] = createSignal(false);

    return (
        <>
            <PaperButton onClick={() => setOpen(true)}>Preview</PaperButton>
            <PaperPreviewModal
                open={open()}
                onClose={() => setOpen(false)}
                src={props.url}
                name={props.name}
                type={props.type}
                actions={<PaperButton size="small" onClick={() => save(props.url, props.name)}>Save</PaperButton>}
            />
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="loading-file">A file that is still loading</PaperText>
            <PaperText preset="body" as="p">
                Open the preview first and set <PaperCode>src</PaperCode> when the download finishes. Pass <PaperCode>error</PaperCode> if it fails.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPreviewModal
    open={open()}
    onClose={() => setOpen(false)}
    name={file.name}
    type={file.type}
    src={download.url}
    error={download.failure}
/>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A dialog with a title, a form, or buttons is <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>.</li>
                <li>A file named in a sentence, that opens a preview, is <PaperLink href="/docs/paperui/paperinlinechip/">PaperInlineChip</PaperLink>.</li>
                <li>A folder of files to browse and edit is <PaperLink href="/docs/paperui/paperfilebrowser/">PaperFileBrowser</PaperLink>, which previews with PaperPreview.</li>
                <li>One kind of file on its own is its own component: <PaperLink href="/docs/paperui/papervideo/">PaperVideo</PaperLink>, <PaperLink href="/docs/paperui/paperaudio/">PaperAudio</PaperLink>, <PaperLink href="/docs/paperui/paperpdf/">PaperPdf</PaperLink>, <PaperLink href="/docs/paperui/papermodel/">PaperModel</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
