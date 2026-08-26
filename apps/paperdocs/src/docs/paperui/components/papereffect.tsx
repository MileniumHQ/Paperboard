import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperEffect,
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
            <PaperText preset="header">PaperEffect</PaperText>
            <PaperText preset="body">
                <strong>PaperEffect</strong> is a tactile elevation decorator primitive that wraps interactive controls to impart physical depth, displacement offsets, and color-matched drop borders.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperEffect implements the signature tactile interaction pattern of the Paperboard design system. When wrapped around an interactive element (such as a <PaperLink href="/paperui/paperbutton"><PaperCode>PaperButton</PaperCode></PaperLink> or container), it generates a solid drop shadow border offset and compresses downward during active pointer press events.
            </PaperText>

            <PaperSeparator />

            <PaperText id="variants" preset="subheader">
                Color variants and neutral state
            </PaperText>
            <PaperText preset="body">
                The component supports chromatic brand themes alongside a neutral <PaperCode>colorless</PaperCode> mode:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="double">
    <PaperEffect variant="brand">
        <PaperButton variant="brand">Brand Effect</PaperButton>
    </PaperEffect>
    <PaperEffect variant="green">
        <PaperButton variant="green">Green Effect</PaperButton>
    </PaperEffect>
    <PaperEffect variant="red">
        <PaperButton variant="red">Red Effect</PaperButton>
    </PaperEffect>
    <PaperEffect colorless>
        <PaperButton>Neutral Effect</PaperButton>
    </PaperEffect>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="double" wrap>
                    <PaperEffect variant="brand">
                        <PaperButton variant="brand">Brand Effect</PaperButton>
                    </PaperEffect>
                    <PaperEffect variant="green">
                        <PaperButton variant="green">Green Effect</PaperButton>
                    </PaperEffect>
                    <PaperEffect variant="red">
                        <PaperButton variant="red">Red Effect</PaperButton>
                    </PaperEffect>
                    <PaperEffect colorless>
                        <PaperButton>Neutral Effect</PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="auto-matching" preset="subheader">
                Automatic child matching
            </PaperText>
            <PaperText preset="body">
                When no explicit <PaperCode>variant</PaperCode> or <PaperCode>colorless</PaperCode> prop is set, PaperEffect inspects its children and tints itself to match them. Using CSS <PaperCode>:has()</PaperCode> selectors, an effect wrapping a color-classed child adopts that child's shadow hue — for example, wrapping a <PaperCode>variant="green"</PaperCode> button turns the offset border green without any props on the effect itself.
            </PaperText>
            <PaperText preset="body">
                Wrapping a text-variant child (such as <PaperCode>&lt;PaperButton variant="text"&gt;</PaperCode>) switches the effect to a different shadow mode: instead of a solid offset layer behind the element, hover displacement renders as an offset box-shadow while the underlying layer is hidden and margins collapse to zero. The same neutral treatment applies when the wrapped content is disabled.
            </PaperText>

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
                        <td><PaperCode>"blue" | "green" | "yellow" | "red" | "brand"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Color scheme controlling the solid bottom-offset border hue.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>colorless</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Forces a neutral dark border offset instead of a chromatic tint.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Deactivates hover displacement and forces colorless styling.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbutton">PaperButton</PaperLink> — Primary interactive element wrapped by PaperEffect.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperselector">PaperSelector</PaperLink> — Segmented control utilizing PaperEffect for selected states.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/colors">Colors</PaperLink> — Specification for <PaperCode>--paper-back-*</PaperCode> depth tokens.
                </PaperText>
            </PaperTextList>
        </>
    );
}
