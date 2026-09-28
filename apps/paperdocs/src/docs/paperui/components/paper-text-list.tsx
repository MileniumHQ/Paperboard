import {
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function PaperTextListDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperTextList</PaperText>
            <PaperText preset="body">
                PaperTextList renders ordered and unordered text lists formatted with standardized spacing intervals.
                Reach for PaperTextList when documenting prerequisites, multi-step instructions, or feature summaries.
                The list exposes sizing and item spacing presets matching the PaperUI typography scale.
            </PaperText>

            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Place PaperTextList.Item components inside PaperTextList.
                Set ordered to true to render numbered items.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperTextList, PaperCard } from "@paperboard-dev/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperTextList>
                <PaperTextList.Item>Clone the repository</PaperTextList.Item>
                <PaperTextList.Item>Install dependencies</PaperTextList.Item>
                <PaperTextList.Item>Run the development build</PaperTextList.Item>
            </PaperTextList>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperCard padding="double" surface="front">
                <PaperTextList>
                    <PaperTextList.Item>Clone the repository</PaperTextList.Item>
                    <PaperTextList.Item>Install dependencies</PaperTextList.Item>
                    <PaperTextList.Item>Run the development build</PaperTextList.Item>
                </PaperTextList>
            </PaperCard>

            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperText preset="body">
                PaperTextList accepts the following list properties:
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
                            <td><PaperCode>PaperTextPreset</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Typography preset matching the PaperText scale (e.g. body, caption, section).</td>
                        </tr>
                        <tr>
                            <td><PaperCode>ordered</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Renders an ol element with decimal counting instead of a ul element.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>spacing</PaperCode></td>
                            <td><PaperCode>"compact" | "normal" | "relaxed"</PaperCode></td>
                            <td><PaperCode>"normal"</PaperCode></td>
                            <td>Vertical gap distance between successive list items.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>size</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>3</PaperCode></td>
                            <td>Typography size index matching the PaperText scale.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>weight</PaperCode></td>
                            <td><PaperCode>number</PaperCode></td>
                            <td><PaperCode>400</PaperCode></td>
                            <td>Font weight numeric value.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>color</PaperCode></td>
                            <td><PaperCode>PaperColor</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>Semantic color role or token name applied to list items.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>family</PaperCode></td>
                            <td><PaperCode>"body" | "code"</PaperCode></td>
                            <td><PaperCode>"body"</PaperCode></td>
                            <td>Switches typography family to monospace code when set.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>rounded</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Applies rounded font family styling.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>breakWord</PaperCode></td>
                            <td><PaperCode>boolean</PaperCode></td>
                            <td><PaperCode>false</PaperCode></td>
                            <td>Enables word-breaking and overflow-wrapping.</td>
                        </tr>
                        <tr>
                            <td><PaperCode>type</PaperCode></td>
                            <td><PaperCode>string</PaperCode></td>
                            <td><PaperCode>undefined</PaperCode></td>
                            <td>CSS list-style-type property: disc, circle, square, decimal, none.</td>
                        </tr>
                    </tbody>
                </PaperTable>

            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                PaperTextList renders semantic ul or ol elements.
                PaperTextList.Item renders an li element styled through the PaperText typography component.
            </PaperText>

            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                Render ordered lists for sequential workflows.
            </PaperText>
            <PaperCode block language="tsx">
{`<PaperTextList ordered spacing="compact">
    <PaperTextList.Item>Step one</PaperTextList.Item>
    <PaperTextList.Item>Step two</PaperTextList.Item>
</PaperTextList>`}
            </PaperCode>
            <PaperCard padding="double" surface="front">
                <PaperTextList ordered spacing="compact">
                    <PaperTextList.Item>Step one</PaperTextList.Item>
                    <PaperTextList.Item>Step two</PaperTextList.Item>
                </PaperTextList>
            </PaperCard>
        </PaperFlex>
    );
}
