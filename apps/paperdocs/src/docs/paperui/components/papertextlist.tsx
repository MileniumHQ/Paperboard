import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperTextList</PaperText>
            <PaperText preset="body">
                <strong>PaperTextList</strong> is a structured typography list container component rendering ordered or unordered bullet points with token-aligned spacing and item sizing.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperTextList renders semantic HTML <PaperCode>&lt;ul&gt;</PaperCode> and <PaperCode>&lt;ol&gt;</PaperCode> lists formatted with PaperUI typography tokens, consistent indentation, and configurable spacing density (<PaperCode>"compact"</PaperCode>, <PaperCode>"normal"</PaperCode>, <PaperCode>"relaxed"</PaperCode>). The attached <PaperCode>PaperTextList.Item</PaperCode> primitive renders individual entries.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Lists accept standard <PaperCode>PaperText</PaperCode> elements or the built-in <PaperCode>PaperTextList.Item</PaperCode> primitive, which renders a <PaperCode>PaperText</PaperCode> as an <PaperCode>&lt;li&gt;</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperTextList } from "@paperboard-dev/paperui";

function FeatureList() {
    return (
        <PaperTextList spacing="relaxed" weight={500}>
            <PaperTextList.Item preset="body">
                Fine-grained SolidJS reactive primitives.
            </PaperTextList.Item>
            <PaperTextList.Item preset="body">
                Standardized CSS custom property tokens.
            </PaperTextList.Item>
            <PaperTextList.Item preset="body" size={2}>
                Per-item sizing and weight overrides.
            </PaperTextList.Item>
        </PaperTextList>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full">
                    <PaperTextList spacing="normal">
                        <PaperText preset="body">
                            <strong>Reactivity:</strong> Fine-grained SolidJS reactive primitives without a virtual DOM.
                        </PaperText>
                        <PaperText preset="body">
                            <strong>Tokenization:</strong> Standardized CSS Custom Property design tokens.
                        </PaperText>
                        <PaperText preset="body">
                            <strong>Tactility:</strong> Isometric elevation displacement on interactive controls.
                        </PaperText>
                    </PaperTextList>

                    <PaperSeparator />

                    <PaperTextList ordered spacing="compact">
                        <PaperText preset="body">Install dependencies from NPM.</PaperText>
                        <PaperText preset="body">Import global stylesheet in entrypoint.</PaperText>
                        <PaperText preset="body">Encapsulate application in PaperProvider.</PaperText>
                    </PaperTextList>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical specification
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
                        <td><PaperCode>ordered</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders an ordered &lt;ol&gt; list instead of an unordered &lt;ul&gt;.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>spacing</PaperCode></td>
                        <td><PaperCode>"compact" | "normal" | "relaxed"</PaperCode></td>
                        <td><PaperCode>"normal"</PaperCode></td>
                        <td>Vertical gap spacing preset between consecutive list items.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>"disc" | "circle" | "square" | "decimal" | "none" | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>CSS list-style-type marker style.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>number (0–17)</PaperCode></td>
                        <td><PaperCode>3 (16px)</PaperCode></td>
                        <td>Text size scale token applied across list item children.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>weight</PaperCode></td>
                        <td><PaperCode>number (100–900)</PaperCode></td>
                        <td><PaperCode>400</PaperCode></td>
                        <td>Numeric font-weight declaration applied across list item children.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertext">PaperText</PaperLink> — Individual typography element.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> — Interactive single-selection item list.
                </PaperText>
            </PaperTextList>
        </>
    );
}
