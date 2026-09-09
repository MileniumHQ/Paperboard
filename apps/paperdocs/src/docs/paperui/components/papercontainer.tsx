import {
    PaperButton,
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
            <PaperText preset="header">PaperContainer</PaperText>
            <PaperText preset="body">
                <strong>PaperContainer</strong> is a framed container primitive that provides visual separation, a bound background token, and rounded border geometry.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperContainer renders a full-width frame that establishes a visual boundary by applying the <PaperCode>--paper-background-frontest</PaperCode> background, a <PaperCode>--paper-medium-border</PaperCode> border, and the standard border radius. It is used throughout Paperboard to enclose cards, code previews, and other grouped content.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The component accepts arbitrary child elements, commonly combined with <PaperLink href="/paperui/paperflex"><PaperCode>PaperFlex</PaperCode></PaperLink> to organize content alignment:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperContainer>
    <PaperFlex padding="double" gap="full" center>
        <PaperText preset="title">Encapsulated Content</PaperText>
        <PaperText preset="body">
            This card is rendered inside a standard PaperContainer.
        </PaperText>
        <PaperButton variant="blue">Interact</PaperButton>
    </PaperFlex>
</PaperContainer>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperContainer style={{ width: "100%", "max-width": "var(--paper-centered-width-small)" }}>
                        <PaperFlex padding="double" gap="half" center>
                            <PaperText preset="title">Encapsulated Content</PaperText>
                            <PaperText preset="body">
                                This card is rendered inside a standard PaperContainer.
                            </PaperText>
                            <PaperButton variant="blue">Interact</PaperButton>
                        </PaperFlex>
                    </PaperContainer>
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Content nodes rendered within the container frame.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>flex</PaperCode></td>
                        <td><PaperCode>boolean | number | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Flex item sizing rule. Shares layout context with <PaperCode>PaperFlex</PaperCode> to automatically guard min-height/min-width in scrollable containers.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>shrink</PaperCode> / <PaperCode>grow</PaperCode></td>
                        <td><PaperCode>boolean | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Explicit flex shrink or grow constraints (<PaperCode>shrink=&#123;0&#125;</PaperCode> prevents compression).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode> / <PaperCode>fullHeight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Expands width or height to occupy 100% of parent dimensions.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>scrollable</PaperCode></td>
                        <td><PaperCode>boolean | "x" | "y"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Enables content overflow scrolling along horizontal, vertical, or both axes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode> / <PaperCode>classList</PaperCode></td>
                        <td><PaperCode>string | Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom CSS classes or conditional class mappings.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>style</PaperCode></td>
                        <td><PaperCode>JSX.CSSProperties | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Inline style overrides for custom widths, paddings, or backgrounds.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — Layout primitive frequently wrapped inside PaperContainer.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/variables">Variables and Spacing</PaperLink> — Border radius and background token reference.
                </PaperText>
            </PaperTextList>
        </>
    );
}
