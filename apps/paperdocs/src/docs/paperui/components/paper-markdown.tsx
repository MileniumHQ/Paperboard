import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperMarkdown,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";

export default function PaperMarkdownDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperMarkdown</PaperText>
            <PaperText preset="body">
                PaperMarkdown renders markdown as PaperUI elements: headings
                become PaperText, links become PaperLink, code becomes
                PaperCode, lists become PaperTextList, and tables become
                PaperTable. It never assigns innerHTML, so no sanitizer is
                needed and raw HTML in the source is shown as literal text
                instead of executed.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass the markdown source as the text prop. Images are blocked
                unless the caller opts in, because a remote image is a beacon.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperMarkdown } from "@paperboard-dev/paperui";

export function ReleaseNotes() {
    return (
        <PaperMarkdown
            text={"## 2.1\\n\\n- Faster startup\\n- **New** sync engine\\n\\nSee [docs](https://paperboard.dev)."}
        />
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperMarkdown
                    text={
                        "## Release notes\n\n- Faster startup\n- **New** sync engine\n\nSee [docs](https://paperboard.dev)."
                    }
                />
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>Markdown source, parsed with GitHub-flavored tables and line breaks.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>preset</PaperCode></td>
                        <td><PaperCode>PaperTextPreset</PaperCode></td>
                        <td><PaperCode>"body"</PaperCode></td>
                        <td>Text preset used for paragraphs and list items.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>allowImages</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders <PaperCode>![alt](src)</PaperCode> images. Off by default: remote images are beacons.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" id="trust-boundary">Trust boundary</PaperText>
            <PaperText preset="body">
                The component renders structure, not arbitrary HTML. Raw HTML
                blocks are printed as source text, unsafe URL schemes such as
                javascript: are refused, and data: image sources are refused
                even when images are allowed.
            </PaperText>
        </PaperFlex>
    );
}
