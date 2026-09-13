import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperQuote</PaperText>
            <PaperText preset="body">
                <strong>PaperQuote</strong> is a callout, blockquote, and advisory alert component providing semantic color accents, leading icons, titles, and formatted prose containers.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperQuote is used throughout documentation and user interfaces to draw attention to critical requirements, advisory notices, technical caveats, and informative context. It supports six color variants with matched left-accent borders and background surface tints.
            </PaperText>

            <PaperSeparator />

            <PaperText id="variants" preset="subheader">
                Color variants
            </PaperText>
            <PaperText preset="body">
                The component supports <PaperCode>"monochrome"</PaperCode>, <PaperCode>"blue"</PaperCode>, <PaperCode>"green"</PaperCode>, <PaperCode>"yellow"</PaperCode>, <PaperCode>"red"</PaperCode>, and <PaperCode>"brand"</PaperCode>:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex gap="half">
    <PaperQuote variant="blue" icon="info" title="Informational Note">
        System services operate within standard parameters.
    </PaperQuote>

    <PaperQuote variant="green" icon="check_circle" title="Success">
        Workspace migration concluded with zero validation errors.
    </PaperQuote>

    <PaperQuote variant="yellow" icon="warning" title="Advisory Warning">
        Storage usage has exceeded 80% of allocated disk quota.
    </PaperQuote>

    <PaperQuote variant="red" icon="error" title="Critical Exception">
        Database connection lost. Immediate intervention required.
    </PaperQuote>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="half">
                    <PaperQuote variant="blue" icon="info" title="Informational Note">
                        System services operate within standard parameters.
                    </PaperQuote>
                    <PaperQuote variant="green" icon="check_circle" title="Success">
                        Workspace migration concluded with zero validation errors.
                    </PaperQuote>
                    <PaperQuote variant="yellow" icon="warning" title="Advisory Warning">
                        Storage usage has exceeded 80% of allocated disk quota.
                    </PaperQuote>
                    <PaperQuote variant="red" icon="error" title="Critical Exception">
                        Database connection lost. Immediate intervention required.
                    </PaperQuote>
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
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>"monochrome" | "blue" | "green" | "yellow" | "red" | "brand"</PaperCode></td>
                        <td><PaperCode>"monochrome"</PaperCode></td>
                        <td>Semantic color scheme controlling the left accent border and icon tint.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Material glyph string or icon element rendered beside the quote content.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Bold title header rendered above the child prose.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Body text or arbitrary JSX elements inside the quote callout.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Inline status label sharing color variant tokens.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercontainer">PaperContainer</PaperLink> — Framed container primitive.
                </PaperText>
            </PaperTextList>
        </>
    );
}
