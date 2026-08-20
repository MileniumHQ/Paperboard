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
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperContainer</PaperText>
            <PaperText preset="body">
                A standardized framed container primitive providing visual separation, elevation shadows, background token binding, and rounded border geometry.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperContainer</strong> is the foundational structural frame in PaperUI. It establishes a distinct visual boundary by applying <PaperCode>--paper-background-front</PaperCode>, <PaperCode>--paper-medium-border</PaperCode>, standard border radii (12px), and subtle ambient shadows (<PaperCode>--paper-element-shadow</PaperCode>). It is ubiquitously utilized across Paperboard to encapsulate cards, code previews, and interactive modules.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
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
                    <PaperContainer style={{ width: "100%", "max-width": "420px" }}>
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Content nodes rendered within the container frame.</td>
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
                    <PaperLink href="/paperui/variables">Variables & Spacing</PaperLink> — Elevation tokens and border radii reference.
                </PaperText>
            </PaperTextList>
        </>
    );
}
