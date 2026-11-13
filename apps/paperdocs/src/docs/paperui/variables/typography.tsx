import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";
import type { PaperTextPreset } from "@mileniumhq/paperui";

const presets: Array<{ preset: PaperTextPreset; size: number; px: number; weight: number; note: string }> = [
    { preset: "headline", size: 12, px: 42, weight: 800, note: "The largest preset: a display line." },
    { preset: "header", size: 10, px: 34, weight: 700, note: "The page title and the h1 of a docs page." },
    { preset: "subheader", size: 7, px: 24, weight: 600, note: "A section heading (h2)." },
    { preset: "title", size: 6, px: 22, weight: 700, note: "The title at the top of a page or a wizard step, and a subsection heading (h3)." },
    { preset: "subtitle", size: 3, px: 16, weight: 500, note: "A line under a title." },
    { preset: "heading", size: 2, px: 14, weight: 700, note: "The heading over a group of cards or rows. Colored text-subtle." },
    { preset: "section", size: 1, px: 12, weight: 700, note: "An uppercase overline over a menu or list group, with letter spacing. Colored text-subtle." },
    { preset: "label", size: 4, px: 18, weight: 600, note: "The name of one card, row, or empty state." },
    { preset: "text", size: 3, px: 16, weight: 400, note: "A sentence of app copy." },
    { preset: "body", size: 3, px: 16, weight: 400, note: "Long reading, such as documentation. Line height is 1.75." },
    { preset: "hint", size: 2, px: 14, weight: 400, note: "Supporting text: descriptions, status, counts, notes. Colored text-subtle." },
    { preset: "error", size: 2, px: 14, weight: 400, note: "A failure shown next to what failed. Colored danger." },
    { preset: "caption", size: 1, px: 12, weight: 500, note: "The smallest preset, for fine print." },
];

const sizes = [
    { step: 0, px: 0 }, { step: 1, px: 12 }, { step: 2, px: 14 }, { step: 3, px: 16 }, { step: 4, px: 18 }, { step: 5, px: 20 },
    { step: 6, px: 22 }, { step: 7, px: 24 }, { step: 8, px: 26 }, { step: 9, px: 30 }, { step: 10, px: 34 }, { step: 11, px: 38 },
    { step: 12, px: 42 }, { step: 13, px: 50 }, { step: 14, px: 58 }, { step: 15, px: 66 }, { step: 16, px: 74 }, { step: 17, px: 82 },
];

export default function TypographyDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Typography</PaperText>
            <PaperText preset="body" as="p">
                PaperUI sets type with presets, a numbered size scale, and a short list of weights.
                Pick a preset for what the text is and a panel gets a size, weight, and color that match every other panel.
                Reach for a raw size or weight only when no preset fits.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="presets">Presets</PaperText>
            <PaperText preset="body" as="p">
                Set <PaperCode>preset</PaperCode> on <PaperLink href="/docs/paperui/papertext/">PaperText</PaperLink>.
                A preset is a size step and a weight, and a few also set a color, a case, or a line height in the stylesheet.
                The type <PaperCode>PaperTextPreset</PaperCode> is the union of the names below.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex gap="half">
                    {presets.map((p) => (
                        <PaperText preset={p.preset}>{p.preset}</PaperText>
                    ))}
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFlex, PaperText } from "@mileniumhq/paperui";

<PaperFlex gap="half">
    <PaperText preset="headline">headline</PaperText>
    <PaperText preset="header">header</PaperText>
    <PaperText preset="subheader">subheader</PaperText>
    <PaperText preset="title">title</PaperText>
    <PaperText preset="subtitle">subtitle</PaperText>
    <PaperText preset="heading">heading</PaperText>
    <PaperText preset="section">section</PaperText>
    <PaperText preset="label">label</PaperText>
    <PaperText preset="text">text</PaperText>
    <PaperText preset="body">body</PaperText>
    <PaperText preset="hint">hint</PaperText>
    <PaperText preset="error">error</PaperText>
    <PaperText preset="caption">caption</PaperText>
</PaperFlex>`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Preset</th>
                        <th>Size step</th>
                        <th>Pixels</th>
                        <th>Weight</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    {presets.map((p) => (
                        <tr>
                            <td><PaperCode>{p.preset}</PaperCode></td>
                            <td><PaperCode>{String(p.size)}</PaperCode></td>
                            <td>{p.px}</td>
                            <td>{p.weight}</td>
                            <td>{p.note}</td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Presets name a style, not an element. Pass <PaperCode>as</PaperCode> for the HTML tag: <PaperCode>{'<PaperText preset="title" as="h2">'}</PaperCode>.
                The default element is a <PaperCode>span</PaperCode>.
                Text with no preset uses size step 4 (18 pixels) and weight 400.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="size-scale">Size scale</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>size</PaperCode> on PaperText is a step from 0 to 17 (the type <PaperCode>PaperTextSize</PaperCode>, listed in <PaperCode>textSizes</PaperCode>).
                Each step is the variable <PaperCode>--paper-text-size-N</PaperCode>.
                Components that take a <PaperCode>size</PaperCode> number, such as PaperTextList, use the same steps.
                Step 0 is zero pixels and exists for icons that must not add height.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Step</th>
                        <th>Pixels</th>
                        <th>Variable</th>
                    </tr>
                </thead>
                <tbody>
                    {sizes.map((s) => (
                        <tr>
                            <td><PaperCode>{String(s.step)}</PaperCode></td>
                            <td>{s.px}</td>
                            <td><PaperCode>{`--paper-text-size-${s.step}`}</PaperCode></td>
                        </tr>
                    ))}
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="weights">Weights and line height</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>weight</PaperCode> on PaperText is a number. The fonts are variable and cover 200 to 1000.
                The stylesheet names the steps components use.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-weight-regular</PaperCode></td>
                        <td>400</td>
                        <td><PaperCode>--paper-leading-none</PaperCode></td>
                        <td>1</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-medium</PaperCode></td>
                        <td>500</td>
                        <td><PaperCode>--paper-leading-tight</PaperCode></td>
                        <td>1.1</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-semibold</PaperCode></td>
                        <td>600</td>
                        <td><PaperCode>--paper-leading-snug</PaperCode></td>
                        <td>1.25</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-bold</PaperCode></td>
                        <td>700</td>
                        <td><PaperCode>--paper-leading-normal</PaperCode></td>
                        <td>1.45</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-weight-black</PaperCode></td>
                        <td>900, for display type such as a wordmark</td>
                        <td><PaperCode>--paper-leading-relaxed</PaperCode></td>
                        <td>1.6</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>--paper-text-tracking</PaperCode> (<PaperCode>0.05em</PaperCode>) is the letter spacing of uppercase overlines.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="families">Font families</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>@mileniumhq/paperui/style.css</PaperCode> loads the fonts as files, so a panel never depends on a font being installed.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Font</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>--paper-font-family</PaperCode></td>
                        <td>Nunito Sans, then the system sans-serif fonts</td>
                        <td>All text. The provider and <PaperCode>panel.css</PaperCode> set it on the document.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-rounded</PaperCode></td>
                        <td>Nunito, then the system sans-serif fonts</td>
                        <td>Friendly display text: PaperText <PaperCode>rounded</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-font-family-code</PaperCode></td>
                        <td>SUSE Mono, then <PaperCode>monospace</PaperCode></td>
                        <td>Code, terminals, and numbers that align: PaperText <PaperCode>family="code"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>--paper-icon-font-family</PaperCode></td>
                        <td>Material Symbols Rounded</td>
                        <td>Icon glyphs. Draw icons with <PaperLink href="/docs/paperui/papericon/">PaperIcon</PaperLink>, never with this variable.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="paper-text-props">PaperText props that change type</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>preset</PaperCode></td><td>Applies a preset's size and weight and its stylesheet rules.</td></tr>
                    <tr><td><PaperCode>size</PaperCode></td><td>A size step 0 to 17. Wins over the preset's size.</td></tr>
                    <tr><td><PaperCode>weight</PaperCode></td><td>A font weight number. Wins over the preset's weight.</td></tr>
                    <tr><td><PaperCode>family</PaperCode></td><td><PaperCode>"code"</PaperCode> switches to the monospace family. <PaperCode>"body"</PaperCode> is the default.</td></tr>
                    <tr><td><PaperCode>rounded</PaperCode></td><td>Uses the rounded family.</td></tr>
                    <tr><td><PaperCode>color</PaperCode></td><td>A <PaperLink href="/docs/paperui/colors/">color token</PaperLink>. Wins over the preset's color.</td></tr>
                    <tr><td><PaperCode>truncate</PaperCode></td><td><PaperCode>true</PaperCode> cuts at one line with an ellipsis. A number above 1 cuts at that many lines.</td></tr>
                    <tr><td><PaperCode>breakWord</PaperCode></td><td>Breaks long words, such as paths and tokens, at the container's edge.</td></tr>
                    <tr><td><PaperCode>inset</PaperCode></td><td>Indents by <PaperCode>--paper-inset-outside</PaperCode>, so text outside a card lines up with text inside one.</td></tr>
                </tbody>
            </PaperTable>
            <PaperTextList>
                <li>A <PaperCode>PaperText</PaperCode> with an <PaperCode>id</PaperCode> also draws a small link button after its text that copies a link to the anchor. Give ids to section headings and to nothing else.</li>
                <li>Inline code is <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>, not PaperText with a monospace family.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="relative-metrics">Relative metrics</PaperText>
            <PaperText preset="body" as="p">
                Components size some inline parts relative to the text around them, so they scale with it.
                These are the values.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-code-font-scale</PaperCode></td><td>0.88em</td></tr>
                    <tr><td><PaperCode>--paper-badge-font-scale</PaperCode></td><td>0.88em</td></tr>
                    <tr><td><PaperCode>--paper-link-font-scale</PaperCode></td><td>0.85em</td></tr>
                    <tr><td><PaperCode>--paper-inline-icon-scale</PaperCode></td><td>1.15em</td></tr>
                    <tr><td><PaperCode>--paper-icon-font-scale</PaperCode></td><td>0.72em</td></tr>
                    <tr><td><PaperCode>--paper-kbd-min-width</PaperCode></td><td>1.6em</td></tr>
                    <tr><td><PaperCode>--paper-code-padding-x</PaperCode></td><td>0.35em</td></tr>
                    <tr><td><PaperCode>--paper-code-padding-y</PaperCode></td><td>0.15em</td></tr>
                    <tr><td><PaperCode>--paper-console-line-height</PaperCode></td><td>1.45em</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
