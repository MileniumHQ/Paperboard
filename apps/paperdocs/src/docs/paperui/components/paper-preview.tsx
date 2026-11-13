import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperPreview,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const markdownSrc = URL.createObjectURL(
    new Blob(["# Release notes\n\n- Faster startup\n- A new **backup** screen\n\nSee `README.md` for more.\n"], { type: "text/plain" }),
);
const codeSrc = URL.createObjectURL(
    new Blob(["export function greet(name: string) {\n    return `Hello, ${name}`;\n}\n"], { type: "text/plain" }),
);

export default function PaperPreviewDoc() {
    const [markdown, setMarkdown] = createSignal(false);
    const [code, setCode] = createSignal(false);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPreview</PaperText>
            <PaperText preset="body" as="p">
                PaperPreview shows a file over the page, the way <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> shows a dialog.
                An image is shown as itself, a video in <PaperLink href="/docs/paperui/papervideo/">PaperVideo</PaperLink> (on a phone or tablet, straight in the system's own full-screen player, and leaving it closes the preview), audio in <PaperLink href="/docs/paperui/paperaudio/">PaperAudio</PaperLink>, Markdown in <PaperLink href="/docs/paperui/papermarkdown/">PaperMarkdown</PaperLink>, and code and plain text in <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>.
                Use it for a file the user picked or an attachment in a message.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Like a modal, a preview is always mounted and driven by <PaperCode>open</PaperCode>.
                Keep a boolean signal, set it from the trigger, and clear it in <PaperCode>onClose</PaperCode>.
                Pass the file's address in <PaperCode>src</PaperCode> and its name in <PaperCode>name</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex gap="full">
                    <PaperButton onClick={() => setMarkdown(true)}>Preview markdown</PaperButton>
                    <PaperButton onClick={() => setCode(true)}>Preview code</PaperButton>
                </PaperFlex>
                <PaperPreview open={markdown()} onClose={() => setMarkdown(false)} src={markdownSrc} name="release-notes.md" />
                <PaperPreview open={code()} onClose={() => setCode(false)} src={codeSrc} name="greet.ts" />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperPreview } from "@mileniumhq/paperui";

const src = URL.createObjectURL(
    new Blob(["# Release notes\\n\\n- Faster startup\\n"], { type: "text/plain" }),
);

export function Example() {
    const [open, setOpen] = createSignal(false);

    return (
        <>
            <PaperButton onClick={() => setOpen(true)}>Preview markdown</PaperButton>
            <PaperPreview
                open={open()}
                onClose={() => setOpen(false)}
                src={src}
                name="release-notes.md"
            />
        </>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperPreviewProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>.
                Other props land on the preview's layer, after its <PaperCode>role="dialog"</PaperCode> and its <PaperCode>aria-label</PaperCode> (the file's name).
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
                        <td>Called when the preview asks to close: the Close button, a press outside the file, Escape, or the system Back action. Set <PaperCode>open</PaperCode> to <PaperCode>false</PaperCode> in it, or the preview stays open.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The file's name. It is shown above the file, names the dialog for assistive technology, and its extension tells Markdown and code apart from plain text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>src</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's address. Until it is set, the preview shows a loader. Text is read from it with <PaperCode>fetch</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>The file's media type. <PaperCode>image/*</PaperCode>, <PaperCode>video/*</PaperCode>, and <PaperCode>audio/*</PaperCode> name those kinds.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>kind</PaperCode></td>
                        <td><PaperCode>PaperPreviewKind</PaperCode></td>
                        <td>From <PaperCode>previewKind(name, type)</PaperCode></td>
                        <td>How to show the file, when its name and type do not say.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>language</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>From <PaperCode>previewLanguage(name)</PaperCode></td>
                        <td>The language of code, when the name does not say. Passing it also highlights a file shown as text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>error</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Why the file cannot be shown. The preview draws this message in place of the file.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>actions</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default</td>
                        <td>More buttons, such as a Save, beside Close.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Added to the preview's layer.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="exports">Related exports</PaperText>
            <PaperCode block language="ts">
{`import {
    PAPER_PREVIEW_TEXT_BYTES,
    previewKind,
    previewLanguage,
    type PaperPreviewKind,
} from "@mileniumhq/paperui";

type PaperPreviewKind = "image" | "video" | "audio" | "markdown" | "code" | "text";

previewKind(name: string, type?: string): PaperPreviewKind | null;
previewLanguage(name: string): string;
const PAPER_PREVIEW_TEXT_BYTES: number;`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Behavior</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>previewKind</PaperCode></td>
                        <td>Returns how a file is shown, or <PaperCode>null</PaperCode> when PaperPreview cannot show it, such as a PDF, an archive, or a program. The media type names images, video, and audio. The name tells Markdown, code, and plain text apart. Use it to decide whether to offer a preview at all.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>previewLanguage</PaperCode></td>
                        <td>Returns the language PaperCode highlights the file in, from its extension. It returns <PaperCode>"text"</PaperCode> when PaperCode has no grammar for the extension.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_PREVIEW_TEXT_BYTES</PaperCode></td>
                        <td>1 MB, the most of a text file the preview reads.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PaperPreviewKind</PaperCode></td>
                        <td>The kinds a preview draws: <PaperCode>image</PaperCode>, <PaperCode>video</PaperCode>, <PaperCode>audio</PaperCode>, <PaperCode>markdown</PaperCode>, <PaperCode>code</PaperCode>, and <PaperCode>text</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="closing">Layer and closing</PaperText>
            <PaperTextList>
                <li>The preview shares <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink>'s layer: it is drawn in a portal above the page, stacks with other open modals, and keeps focus inside while open.</li>
                <li>Escape and the system Back action call <PaperCode>onClose</PaperCode>, and so does a press on the dimmed backdrop.</li>
                <li>A Close button, with an x icon and the word Close, sits above the file. The file's name is at its left, and <PaperCode>actions</PaperCode> sit beside Close.</li>
                <li>A press on the empty space around the file closes the preview too.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="kinds">Kinds</PaperText>
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
                        <td>A media type starting with <PaperCode>image/</PaperCode></td>
                        <td>The image itself, scaled to fit and filling the screen.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>video</PaperCode></td>
                        <td>A media type starting with <PaperCode>video/</PaperCode></td>
                        <td>PaperVideo, as tall as the screen allows.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>audio</PaperCode></td>
                        <td>A media type starting with <PaperCode>audio/</PaperCode></td>
                        <td>PaperAudio at full width.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>markdown</PaperCode></td>
                        <td>The type <PaperCode>text/markdown</PaperCode>, or an extension such as <PaperCode>md</PaperCode></td>
                        <td>PaperMarkdown on a sheet.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>code</PaperCode></td>
                        <td>A source extension such as <PaperCode>ts</PaperCode>, <PaperCode>py</PaperCode>, <PaperCode>json</PaperCode>, or <PaperCode>yml</PaperCode></td>
                        <td>PaperCode, highlighted by the extension when PaperCode has a grammar for it, and plain otherwise.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td>A <PaperCode>text/*</PaperCode> type, <PaperCode>application/json</PaperCode>, or an extension such as <PaperCode>txt</PaperCode> or <PaperCode>log</PaperCode></td>
                        <td>PaperCode without highlighting.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                The media type is checked first for images, video, and audio. Then the name decides between Markdown, code, and text.
                A name with no extension, like <PaperCode>Dockerfile</PaperCode>, counts as its own extension.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="loading">Loading and text</PaperText>
            <PaperTextList>
                <li>While <PaperCode>src</PaperCode> is unset, the preview shows a loader. Set it when the address is known, such as after an upload or a download finishes.</li>
                <li>Markdown, code, and text are fetched from <PaperCode>src</PaperCode> only while the preview is open.</li>
                <li>Only the first 1 MB of a text file is read. A longer file is cut there, and a note under it says <PaperCode>Showing the first 1 MB.</PaperCode></li>
                <li>A text file that cannot be read shows <PaperCode>{"<name> couldn't be read (<status>)"}</PaperCode> in place of the file.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperTextList>
                <li>When <PaperCode>error</PaperCode> is set, the preview draws it as a failure in place of the file, in an element with <PaperCode>role="alert"</PaperCode>.</li>
                <li>A file with no kind, because <PaperCode>previewKind</PaperCode> returned <PaperCode>null</PaperCode> and <PaperCode>kind</PaperCode> is not set, shows <PaperCode>{"<name> can't be previewed"}</PaperCode>.</li>
                <li>A video or audio file that fails to play shows the player's own error and Retry.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="attachment">Preview an attachment</PaperText>
            <PaperText preset="body" as="p">
                Offer a preview only for a file <PaperCode>previewKind</PaperCode> can show, and give a Save beside Close with <PaperCode>actions</PaperCode>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal, Show } from "solid-js";
import { PaperButton, PaperPreview, previewKind } from "@mileniumhq/paperui";

export function Attachment(props: { name: string; type: string; url: string }) {
    const [open, setOpen] = createSignal(false);

    return (
        <Show when={previewKind(props.name, props.type)}>
            <PaperButton onClick={() => setOpen(true)}>Preview</PaperButton>
            <PaperPreview
                open={open()}
                onClose={() => setOpen(false)}
                src={props.url}
                name={props.name}
                type={props.type}
                actions={<PaperButton size="small" href={props.url} download={props.name}>Save</PaperButton>}
            />
        </Show>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="loading-file">A file that is still loading</PaperText>
            <PaperText preset="body" as="p">
                Open the preview first and set <PaperCode>src</PaperCode> when the download finishes. Pass <PaperCode>error</PaperCode> if it fails.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperPreview
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
            </PaperTextList>
        </PaperFlex>
    );
}
