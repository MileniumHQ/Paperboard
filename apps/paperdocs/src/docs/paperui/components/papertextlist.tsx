import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperTextList</PaperText>
            <PaperText preset="body">
                A structured typography list container component rendering ordered or unordered bullet points with token-aligned spacing and item sizing.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperTextList</strong> and <strong>PaperTextList.Item</strong> render semantic HTML <PaperCode>&lt;ul&gt;</PaperCode> and <PaperCode>&lt;ol&gt;</PaperCode> lists formatted with PaperUI typography tokens, consistent indentation, and configurable spacing density (<PaperCode>"compact"</PaperCode>, <PaperCode>"normal"</PaperCode>, <PaperCode>"relaxed"</PaperCode>).
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
            </PaperText>
            <PaperText preset="body">
                Lists accept standard <PaperCode>PaperText</PaperCode> elements or <PaperCode>PaperTextList.Item</PaperCode> primitives:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperTextList, PaperText } from "paperui";

function ListShowcase() {
    return (
        <PaperTextList spacing="normal">
            <PaperText preset="body">
                Fine-grained SolidJS reactive primitives.
            </PaperText>
            <PaperText preset="body">
                Standardized CSS Custom Property tokens.
            </PaperText>
            <PaperText preset="body">
                Tactile depth and physical elevation displacement.
            </PaperText>
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
                Technical Specification
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
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
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
