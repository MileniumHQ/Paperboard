import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperKbd,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperKbd</PaperText>
            <PaperText preset="body">
                <strong>PaperKbd</strong> is a semantic keyboard accelerator primitive representing physical keyboard keys, shortcuts, and modifier key combinations.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperKbd encapsulates the HTML5 <PaperCode>&lt;kbd&gt;</PaperCode> element with PaperUI monospaced typography, rounded corner radii, and a subtle tactile lower border. It is frequently rendered in tooltips, search modals, and menu shortcuts to indicate hotkey combinations.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Keyboard chips can be rendered individually or chained together with text separators:
            </PaperText>

            <PaperCode block language="tsx">
                {`<PaperFlex direction="row" gap="full" align="center">
    <PaperFlex direction="row" gap="onefourth" align="center">
        <PaperKbd>Ctrl</PaperKbd>
        <PaperText size={2}>+</PaperText>
        <PaperKbd>K</PaperKbd>
    </PaperFlex>

    <PaperFlex direction="row" gap="onefourth" align="center">
        <PaperKbd>⌘</PaperKbd>
        <PaperKbd>Shift</PaperKbd>
        <PaperKbd>P</PaperKbd>
    </PaperFlex>

    <PaperFlex direction="row" gap="onefourth" align="center">
        <PaperKbd>Esc</PaperKbd>
    </PaperFlex>
</PaperFlex>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center direction="row" gap="double" wrap>
                    <PaperFlex direction="row" gap="onefourth" align="center">
                        <PaperKbd>Ctrl</PaperKbd>
                        <PaperText size={2}>+</PaperText>
                        <PaperKbd>K</PaperKbd>
                    </PaperFlex>

                    <PaperFlex direction="row" gap="onefourth" align="center">
                        <PaperKbd>⌘</PaperKbd>
                        <PaperKbd>Shift</PaperKbd>
                        <PaperKbd>P</PaperKbd>
                    </PaperFlex>

                    <PaperFlex direction="row" gap="onefourth" align="center">
                        <PaperKbd>Esc</PaperKbd>
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
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>The key label or symbol character string.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode> / <PaperCode>classList</PaperCode></td>
                        <td><PaperCode>string | Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom CSS classes or conditional class bindings.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papercode">PaperCode</PaperLink> — Inline and block code rendering primitive.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperbadge">PaperBadge</PaperLink> — Categorical label and status chip.
                </PaperText>
            </PaperTextList>
        </>
    );
}
