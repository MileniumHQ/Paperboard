import {
    PaperButton,
    PaperCode,
    PaperCenteredInterface,
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
            <PaperText preset="header">PaperCenteredInterface</PaperText>
            <PaperText preset="body">
                <strong>PaperCenteredInterface</strong> is a structural layout template that centers modal-like content, initialization prompts, setup flows, and standalone utility interfaces.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperCenteredInterface is a higher-order layout template in PaperUI designed to constrain and horizontally/vertically center interactive interfaces within a designated viewport. It enforces standard dimensional limits defined by the <PaperCode>--paper-centered-width</PaperCode> and <PaperCode>--paper-centered-height</PaperCode> design tokens.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                The component encapsulates child elements within an internal bounding wrapper, applying boundary isolation and elevation.
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperCenteredInterface, PaperFlex, PaperText, PaperButton } from "@paperboard-dev/paperui";

function WelcomeScreen() {
    return (
        <PaperCenteredInterface>
            <PaperFlex padding="double" gap="full" center>
                <PaperText preset="header">Welcome to Paperboard</PaperText>
                <PaperText preset="body">
                    Select a workspace to initiate the session.
                </PaperText>
                <PaperButton variant="brand">Enter Studio</PaperButton>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center style={{ width: "100%", "min-height": "var(--paper-centered-height-small)" }}>
                    <div style={{ width: "100%", "max-width": "var(--paper-centered-width-medium)" }}>
                        <PaperCenteredInterface style={{ "min-height": "var(--paper-centered-height-small)" }}>
                            <PaperFlex padding="double" gap="half" center>
                                <PaperIcon zeroHeight>dashboard_customize</PaperIcon>
                                <PaperText preset="title">Workspace Initializer</PaperText>
                                <PaperText preset="body">
                                    Centered interface container ready for configuration.
                                </PaperText>
                                <PaperButton variant="blue" tiny>
                                    Initialize
                                </PaperButton>
                            </PaperFlex>
                        </PaperCenteredInterface>
                    </div>
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
                        <td><PaperCode>preset</PaperCode> / <PaperCode>size</PaperCode></td>
                        <td><PaperCode>"small" | "compact" | "medium" | "large" | "wide" | "full" | "fullscreen" | "auto" | "fit"</PaperCode></td>
                        <td><PaperCode>"medium"</PaperCode></td>
                        <td>Preconfigured dimension preset for the internal interface wrapper (<PaperCode>small</PaperCode>: 420x300px, <PaperCode>medium</PaperCode>: 600x400px, <PaperCode>large</PaperCode>: 760x520px, <PaperCode>wide</PaperCode>: 920x580px, <PaperCode>full</PaperCode>: 100%, <PaperCode>auto</PaperCode>: content-sized).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>width</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom explicit width for the interface wrapper (e.g. <PaperCode>"500px"</PaperCode>, <PaperCode>"80vw"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>height</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom explicit height for the interface wrapper (e.g. <PaperCode>"350px"</PaperCode>, <PaperCode>"auto"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>The child elements and sub-templates rendered within the centered viewport.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode> / <PaperCode>classList</PaperCode></td>
                        <td><PaperCode>string | Record&lt;string, boolean&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Custom CSS class names or conditional class objects for the container node.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>style</PaperCode></td>
                        <td><PaperCode>JSX.CSSProperties | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Inline style definitions for overriding dimensional or positioning defaults.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperflex">PaperFlex</PaperLink> — General-purpose flexbox container template.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperwizard">PaperWizard</PaperLink> — Multi-step guided configuration wizard template.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papermodal">PaperModal</PaperLink> — Portal-based dialog overlay component.
                </PaperText>
            </PaperTextList>
        </>
    );
}
