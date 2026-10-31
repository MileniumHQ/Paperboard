import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperTextDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperText</PaperText>
            <PaperText preset="body">
                PaperText renders typographic elements with standardized scales, weights, color tokens, and heading presets.
                Reach for PaperText for all labels, headings, captions, and body copy across your interface.
                The component supports truncation, word breaking, custom HTML tag rendering, and anchor link buttons.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pick text by its role with a preset. Every piece of app text has one, so the same role looks the same in every panel.
                Set color only when a role needs a different meaning, such as a warning.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperText, PaperCard, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="half">
                <PaperText preset="title">Backups</PaperText>
                <PaperText preset="heading">Locations</PaperText>
                <PaperText preset="label">This computer</PaperText>
                <PaperText preset="text">A panel asks where to keep its backups.</PaperText>
                <PaperText preset="hint">2 backups, 140 MB</PaperText>
                <PaperText preset="error">The location is not reachable.</PaperText>
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="title">Backups</PaperText>
                    <PaperText preset="heading">Locations</PaperText>
                    <PaperText preset="label">This computer</PaperText>
                    <PaperText preset="text">A panel asks where to keep its backups.</PaperText>
                    <PaperText preset="hint">2 backups, 140 MB</PaperText>
                    <PaperText preset="error">The location is not reachable.</PaperText>
                </PaperFlex>
            </PaperCard>

            <PaperText preset="subheader" id="presets">Presets</PaperText>
            <PaperText preset="body">
                App presets name a role. Reach for these in panels and the shell:
            </PaperText>
            <PaperTable>
                    <thead>
                        <tr>
                            <th>Preset</th>
                            <th>Style</th>
                            <th>Role</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><PaperCode>title</PaperCode></td>
                            <td>22px, bold</td>
                            <td>The title at the top of a page or wizard step. PaperPageHeader uses it.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>heading</PaperCode></td>
                            <td>14px, bold, subtle</td>
                            <td>The heading over a group of cards or rows. PaperSectionHeader uses it.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>section</PaperCode></td>
                            <td>12px, bold, uppercase, subtle</td>
                            <td>An overline over a menu or list group, such as the sidebar groups.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>label</PaperCode></td>
                            <td>18px, semibold</td>
                            <td>The name of one card, row or empty state. PaperSettingItem and PaperEmptyState use it.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>text</PaperCode></td>
                            <td>16px</td>
                            <td>A sentence of app copy, including the paragraph in a dialog.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>hint</PaperCode></td>
                            <td>14px, subtle</td>
                            <td>Supporting text: descriptions, status, counts and notes.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>error</PaperCode></td>
                            <td>14px, danger</td>
                            <td>A failure shown next to what failed.</td>
                        </tr>
                    </tbody>
                </PaperTable>
            <PaperText preset="body">
                Reading presets set long-form pages like this one. body is for markdown and documentation, with room between lines;
                app copy uses text instead. headline, header, subheader, subtitle and caption shape documentation and marketing pages.
            </PaperText>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperText accepts the following typography properties:
            </PaperText>
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
                            <td><PaperCode>preset</PaperCode></td>
                            <td><PaperCode>"title" | "heading" | "section" | "label" | "text" | "hint" | "error" | "body" | "headline" | "header" | "subheader" | "subtitle" | "caption"</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>The role of the text; sets its size, weight and, for some roles, its color. Any other name is a type error.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>4</PaperCode></td>
                            <td>Direct size index from 0 (0px) through 17 (82px).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>weight</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>400</PaperCode></td>
                            <td>Numeric font-weight (100 to 900).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>as</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>"span"</PaperCode></td>
                            <td>HTML element tag name rendered in the DOM: h1, h2, p, label, span, div.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>color</PaperCode></td>
                            <td><PaperCode>PaperColor</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Semantic color token: text, text-muted, text-subtle, text-faint, primary, danger.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>truncate</PaperCode></td>
                            <td><PaperCode>boolean | number</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Truncates overflowing text with an ellipsis. Pass a number for multi-line clamping.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>inset</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Indents the text by the card inset so text outside a card lines up with the text inside it. See Spacing.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                When an id prop is provided, PaperText renders a copyable anchor link button next to the text.
                Clicking the anchor icon copies the URL fragment to the clipboard.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Line up a hint under a settings card with the row titles inside it.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperFlex direction="column" gap="half">
    <PaperSettingList autoHeight>
        <PaperSettingItem title="Refuse taken ports" />
    </PaperSettingList>
    <PaperText preset="hint" inset>No panel holds a port on this computer.</PaperText>
</PaperFlex>`}
            </PaperCode>
            <PaperFlex direction="column" gap="half">
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Refuse taken ports" />
                </PaperSettingList>
                <PaperText preset="hint" inset>No panel holds a port on this computer.</PaperText>
            </PaperFlex>

            <PaperText preset="body">
                Clamp long descriptions to two lines using numeric truncation.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperText truncate={2}>
    Multi-line text content that is clamped after reaching the second visible line.
</PaperText>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperText truncate={2}>
                    Multi-line text content that is clamped after reaching the second visible line.
                </PaperText>
            </PaperCard>
        </PaperFlex>
    );
}
