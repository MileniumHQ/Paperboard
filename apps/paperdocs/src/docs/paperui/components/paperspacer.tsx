import {
    PaperButton,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperSpacer,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperSpacer</PaperText>
            <PaperText preset="body">
                <strong>PaperSpacer</strong> is a flexible layout and whitespace primitive functioning as an auto-expanding flex spring or fixed-dimension spacing element.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperSpacer</strong> provides non-visual structural spacing within flex layouts. In default mode, it expands with <PaperCode>flex: 1</PaperCode> to distribute opposing flex elements to opposite edges of a container (commonly utilized in application navigation topbars). When supplied with a <PaperCode>size</PaperCode> prop, it enforces fixed-width or fixed-height dimensions.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Inserting an unconstrained <PaperCode>&lt;PaperSpacer /&gt;</PaperCode> creates an expanding spring between elements:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperFlex, PaperText, PaperSpacer, PaperButton } from "@paperboard-dev/paperui";

function TopbarLayout() {
    return (
        <PaperFlex direction="row" align="center" style={{ width: "100%" }}>
            <PaperText preset="title">Brand Title</PaperText>
            <PaperSpacer />
            <PaperButton variant="blue" tiny>Account</PaperButton>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full">
                    <PaperFlex
                        direction="row"
                        align="center"
                        style={{
                            width: "100%",
                            padding: "var(--paper-uigap)",
                            background: "var(--paper-background-frontest)",
                            "border-radius": "var(--paper-border-radius)",
                            border: "1px solid var(--paper-medium-border)",
                        }}
                    >
                        <PaperText preset="title">Brand Title</PaperText>
                        <PaperSpacer />
                        <PaperButton variant="blue" tiny>Account</PaperButton>
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
                        <td><PaperCode>size</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Fixed size for the spacer (disables auto flex expansion). Numbers become pixel values. Named spacing tokens (<PaperCode>"none"</PaperCode>, <PaperCode>"onefourth"</PaperCode>, <PaperCode>"half"</PaperCode>, <PaperCode>"threefourths"</PaperCode>, <PaperCode>"full"</PaperCode>, <PaperCode>"sixfourths"</PaperCode>, <PaperCode>"double"</PaperCode>, <PaperCode>"triple"</PaperCode>, <PaperCode>"quadruple"</PaperCode>) map to the corresponding <PaperCode>--paper-uigap*</PaperCode> variables, and any other string resolves as <PaperCode>var(--paper-&lt;value&gt;)</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>direction</PaperCode></td>
                        <td><PaperCode>"horizontal" | "vertical"</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Constrains fixed dimension calculation to width or height.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — Flex layout container template.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperseparator">PaperSeparator</PaperLink> — Visual line divider primitive.
                </PaperText>
            </PaperTextList>
        </>
    );
}
