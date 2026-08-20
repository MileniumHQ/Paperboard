import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperFlex</PaperText>
            <PaperText preset="body">
                The primary flexbox layout template in PaperUI, providing responsive alignment, standardized gap and padding scales, surface layer background resolution, and interactive pointer-driven resize capabilities.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperFlex</strong> serves as the fundamental structural container for arranging components across horizontal and vertical axes. It bridges the PaperUI design token scale with CSS Flexbox properties, mapping named string literals (such as <PaperCode>"half"</PaperCode> or <PaperCode>"double"</PaperCode>) to computed pixel values derived from <PaperCode>--paper-uigap</PaperCode>.
            </PaperText>

            <PaperSeparator />

            <PaperText id="basic-layout" preset="subheader">
                Basic Layout and Direction
            </PaperText>
            <PaperText preset="body">
                By default, <PaperCode>PaperFlex</PaperCode> arranges child elements along a vertical column. Setting <PaperCode>direction="row"</PaperCode> switches the primary axis to horizontal. The <PaperCode>center</PaperCode> boolean prop concurrently sets both <PaperCode>align-items</PaperCode> and <PaperCode>justify-content</PaperCode> to <PaperCode>"center"</PaperCode>.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="full" center>
    <PaperButton variant="blue">First Item</PaperButton>
    <PaperButton variant="green">Second Item</PaperButton>
    <PaperButton variant="red">Third Item</PaperButton>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperFlex direction="row" gap="full" center>
                        <PaperButton variant="blue">First Item</PaperButton>
                        <PaperButton variant="green">Second Item</PaperButton>
                        <PaperButton variant="red">Third Item</PaperButton>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="background-surfaces" preset="subheader">
                Surface Layer Backgrounds
            </PaperText>
            <PaperText preset="body">
                The <PaperCode>background</PaperCode> prop automatically maps surface identifiers (<PaperCode>"frontest"</PaperCode>, <PaperCode>"front"</PaperCode>, <PaperCode>"back"</PaperCode>, <PaperCode>"backest"</PaperCode>, <PaperCode>"definition"</PaperCode>, <PaperCode>"element"</PaperCode>) to their corresponding CSS theme variables.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="half">
    <PaperFlex background="frontest" padding="full" center>
        <PaperText size={2}>frontest</PaperText>
    </PaperFlex>
    <PaperFlex background="front" padding="full" center>
        <PaperText size={2}>front</PaperText>
    </PaperFlex>
    <PaperFlex background="back" padding="full" center>
        <PaperText size={2}>back</PaperText>
    </PaperFlex>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperFlex direction="row" gap="half" style={{ width: "100%" }}>
                        <PaperFlex
                            background="frontest"
                            padding="full"
                            center
                            style={{
                                flex: "1",
                                "border-radius": "var(--paper-border-radius)",
                                border: "1px solid var(--paper-medium-border)",
                            }}
                        >
                            <PaperText size={2} weight={700}>frontest</PaperText>
                        </PaperFlex>
                        <PaperFlex
                            background="front"
                            padding="full"
                            center
                            style={{
                                flex: "1",
                                "border-radius": "var(--paper-border-radius)",
                                border: "1px solid var(--paper-medium-border)",
                            }}
                        >
                            <PaperText size={2} weight={700}>front</PaperText>
                        </PaperFlex>
                        <PaperFlex
                            background="back"
                            padding="full"
                            center
                            style={{
                                flex: "1",
                                "border-radius": "var(--paper-border-radius)",
                                border: "1px solid var(--paper-medium-border)",
                            }}
                        >
                            <PaperText size={2} weight={700}>back</PaperText>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="resizable" preset="subheader">
                Resizable Panes
            </PaperText>
            <PaperText preset="body">
                Setting <PaperCode>resizable</PaperCode> attaches an interactive drag handle to the trailing edge of the container. Pointer events are captured and bounds are clamped against computed min/max dimensions.
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex
    direction="row"
    resizable
    background="front"
    padding="full"
    style={{ "min-width": "200px", "max-width": "500px" }}
>
    <PaperText size={2}>Drag trailing border to resize width</PaperText>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperFlex
                        direction="row"
                        resizable
                        background="front"
                        padding="full"
                        align="center"
                        style={{
                            "min-width": "220px",
                            "max-width": "460px",
                            "border-radius": "var(--paper-border-radius)",
                            border: "1px solid var(--paper-medium-border)",
                        }}
                    >
                        <PaperIcon zeroHeight>swap_horiz</PaperIcon>
                        <PaperText size={2}>Drag the right handle to resize</PaperText>
                    </PaperFlex>
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
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"row" | "column" | "row-reverse" | "column-reverse"</PaperCode></td>
                        <td><PaperCode>"column"</PaperCode></td>
                        <td>Flex direction axis for laying out child nodes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>gap</PaperCode></td>
                        <td><PaperCode>PaperFlexGap (string | number)</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Inter-element gutter spacing token (<PaperCode>"none"</PaperCode> through <PaperCode>"quadruple"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>padding</PaperCode></td>
                        <td><PaperCode>PaperFlexPadding (string | number)</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Uniform internal padding spacing token.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paddingX</PaperCode> / <PaperCode>paddingY</PaperCode></td>
                        <td><PaperCode>PaperFlexPadding</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Directional padding spacing tokens along horizontal/vertical axes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>align</PaperCode></td>
                        <td><PaperCode>JSX.CSSProperties["align-items"]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Cross-axis alignment rule (<PaperCode>"center"</PaperCode>, <PaperCode>"flex-start"</PaperCode>, etc.).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>justify</PaperCode></td>
                        <td><PaperCode>JSX.CSSProperties["justify-content"]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Main-axis alignment rule (<PaperCode>"center"</PaperCode>, <PaperCode>"space-between"</PaperCode>, etc.).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>center</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Convenience shorthand setting both align and justify to <PaperCode>"center"</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode> / <PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Expands width or height to occupy 100% of parent dimensions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>background</PaperCode></td>
                        <td><PaperCode>PaperFlexBackground</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Surface layer name or custom color token expression.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>resizable</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Enables pointer-driven manual resize dragging handle.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onResize</PaperCode></td>
                        <td><PaperCode>(size: &#123; width?: number; height?: number &#125;) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed during active pointer resize movements.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/variables">Variables & Spacing</PaperLink> — Full reference for the UI gap spacing scale.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercontainer">PaperContainer</PaperLink> — Visual frame wrapper often paired with PaperFlex.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperspacer">PaperSpacer</PaperLink> — Flexible whitespace spacing primitive.
                </PaperText>
            </PaperTextList>
        </>
    );
}
