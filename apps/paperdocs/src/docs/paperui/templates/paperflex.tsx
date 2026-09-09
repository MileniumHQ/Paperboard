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
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperFlex</PaperText>
            <PaperText preset="body">
                <strong>PaperFlex</strong> is the primary flexbox layout template in PaperUI, providing responsive alignment, standardized gap and padding scales, surface layer background resolution, and interactive pointer-driven resize capabilities.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperFlex serves as the fundamental structural container for arranging components across horizontal and vertical axes. It bridges the PaperUI design token scale with CSS Flexbox properties, mapping named string literals (such as <PaperCode>"half"</PaperCode> or <PaperCode>"double"</PaperCode>) to computed values derived from <PaperCode>--paper-uigap</PaperCode>.
            </PaperText>

            <PaperSeparator />

            <PaperText id="basic-layout" preset="subheader">
                Basic layout and direction
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
                Surface layer backgrounds
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
                                border: "var(--paper-border-width) solid var(--paper-medium-border)",
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
                                border: "var(--paper-border-width) solid var(--paper-medium-border)",
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
                                border: "var(--paper-border-width) solid var(--paper-medium-border)",
                            }}
                        >
                            <PaperText size={2} weight={700}>back</PaperText>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="resizable" preset="subheader">
                Resizable panes
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
    style={{ "min-width": "var(--paper-sidebar-width)", "max-width": "var(--paper-centered-width-medium)" }}
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
                            "min-width": "var(--paper-sidebar-width)",
                            "max-width": "var(--paper-centered-width-medium)",
                            "border-radius": "var(--paper-border-radius)",
                            border: "var(--paper-border-width) solid var(--paper-medium-border)",
                        }}
                    >
                        <PaperIcon zeroHeight>swap_horiz</PaperIcon>
                        <PaperText size={2}>Drag the right handle to resize</PaperText>
                    </PaperFlex>
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
                        <td><PaperCode>wrap</PaperCode></td>
                        <td><PaperCode>boolean | JSX.CSSProperties["flex-wrap"]</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Enables flex wrapping. A boolean value maps to <PaperCode>"wrap"</PaperCode> or <PaperCode>"nowrap"</PaperCode>; a string sets the CSS <PaperCode>flex-wrap</PaperCode> value directly (e.g. <PaperCode>"wrap-reverse"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flex</PaperCode></td>
                        <td><PaperCode>boolean | number | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Flex item sizing. A boolean <PaperCode>true</PaperCode> applies <PaperCode>1 1 0%</PaperCode> with automatic <PaperCode>min-height: 0</PaperCode> (or <PaperCode>min-width: 0</PaperCode>) when nested in a flex parent.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>shrink</PaperCode> / <PaperCode>grow</PaperCode></td>
                        <td><PaperCode>boolean | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Explicit flex shrink or grow factor (<PaperCode>shrink=&#123;0&#125;</PaperCode> prevents shrinking).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>minWidth</PaperCode> / <PaperCode>minHeight</PaperCode></td>
                        <td><PaperCode>number | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Minimum dimension constraints (numbers map to pixel values).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean | "x" | "y"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Enables overflow scrolling with automatic flex minimum dimensions.</td>
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
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/variables">Variables and spacing</PaperLink> — Full reference for the UI gap spacing scale.
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
