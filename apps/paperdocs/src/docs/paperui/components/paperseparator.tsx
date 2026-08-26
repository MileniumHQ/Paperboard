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
            <PaperText preset="header">PaperSeparator</PaperText>
            <PaperText preset="body">
                <strong>PaperSeparator</strong> is a visual divider and structural rule primitive rendering horizontal or vertical boundary lines between distinct interface sections.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperSeparator</strong> renders a 1px boundary line utilizing the <PaperCode>--paper-medium-border</PaperCode> design token. It supports both horizontal full-width section breaks and vertical inline dividers for toolbars and navigation bars.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Separators can divide stacked cards horizontally or separate inline toolbar actions vertically:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperSeparator, PaperFlex, PaperText, PaperButton } from "@paperboard-dev/paperui";

function SeparatorShowcase() {
    return (
        <PaperFlex gap="full">
            <PaperText preset="title">Section Alpha</PaperText>
            <PaperSeparator />
            <PaperText preset="title">Section Beta</PaperText>

            <PaperFlex direction="row" align="center" gap="half">
                <PaperButton tiny>Cut</PaperButton>
                <PaperButton tiny>Copy</PaperButton>
                <PaperSeparator vertical style={{ height: "20px" }} />
                <PaperButton tiny>Paste</PaperButton>
            </PaperFlex>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full">
                    <PaperText preset="title">Section Alpha Content</PaperText>
                    <PaperSeparator />
                    <PaperText preset="title">Section Beta Content</PaperText>

                    <PaperSeparator />

                    <PaperFlex direction="row" align="center" gap="half" justify="center">
                        <PaperButton tiny>Cut</PaperButton>
                        <PaperButton tiny>Copy</PaperButton>
                        <PaperSeparator vertical style={{ height: "24px" }} />
                        <PaperButton tiny>Paste</PaperButton>
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
                        <td><PaperCode>direction</PaperCode> / <PaperCode>orientation</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>"horizontal"</PaperCode></td>
                        <td>Axis orientation for the separator line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>vertical</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Convenience boolean setting vertical orientation.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperspacer">PaperSpacer</PaperLink> — Flexible whitespace spacing component.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — Layout container supporting gap spacing.
                </PaperText>
            </PaperTextList>
        </>
    );
}
