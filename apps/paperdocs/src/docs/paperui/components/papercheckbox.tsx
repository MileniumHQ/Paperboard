import {
    PaperCheckbox,
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [agreeTerms, setAgreeTerms] = createSignal(true);
    const [autoUpdate, setAutoUpdate] = createSignal(false);
    const [showSnapshots, setShowSnapshots] = createSignal(false);

    return (
        <>
            <PaperText preset="header">PaperCheckbox</PaperText>
            <PaperText preset="body">
                PaperCheckbox is a compact binary selection primitive providing tactile state elevation, keyboard navigation, and integrated label and descriptive text slots.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperCheckbox</strong> implements an accessible binary input control (<PaperCode>role="checkbox"</PaperCode>). It serves as a compact, square-box alternative to <PaperLink href="/paperui/papertoggle">PaperToggle</PaperLink>, optimized for density in forms, settings lists, data tables, and modal dialogs.
            </PaperText>
            <PaperText preset="body">
                The component encapsulates a hidden native <PaperCode>&lt;input type="checkbox"&gt;</PaperCode> to preserve native form submission capabilities and accessibility tree semantics while presenting a customized rounded box with centered check glyphs.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Checkboxes can be bound to reactive signals using the <PaperCode>checked</PaperCode> and <PaperCode>onChange</PaperCode> props:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperCheckbox, PaperFlex } from "@paperboard-dev/paperui";

function CheckboxExample() {
    const [agree, setAgree] = createSignal(true);

    return (
        <PaperCheckbox
            checked={agree()}
            onChange={setAgree}
            label="I accept the End User License Agreement"
            description="Required before downloading server files"
        />
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <PaperFlex direction="column" gap="full" align="flex-start">
                        <PaperCheckbox
                            checked={agreeTerms()}
                            onChange={(val) => setAgreeTerms(val)}
                            label="I accept the End User License Agreement"
                            description="Required before downloading server files"
                        />

                        <PaperCheckbox
                            checked={autoUpdate()}
                            onChange={(val) => setAutoUpdate(val)}
                            label="Enable automated background updates"
                            description="Automatically fetch the latest game releases"
                        />

                        <PaperCheckbox
                            checked={showSnapshots()}
                            onChange={(val) => setShowSnapshots(val)}
                            label="Show experimental development snapshots"
                        />

                        <PaperCheckbox
                            disabled
                            checked={true}
                            label="Mandatory security updates (disabled)"
                            description="System-managed option that cannot be disabled"
                        />
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
                        <td><PaperCode>checked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Controlled boolean checked state bound to an external reactive signal.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultChecked</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Initial uncontrolled checked state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onChange</PaperCode></td>
                        <td><PaperCode>(checked: boolean) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback invoked with the new boolean state upon user interaction.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Primary text or JSX element displayed adjacent to the checkbox control.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>JSX.Element | string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary descriptive text or JSX element positioned beneath the label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Deactivates toggling and renders the control in a muted state.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertoggle">PaperToggle</PaperLink> — Sliding switch binary control.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperselector">PaperSelector</PaperLink> — Multi-option radio selection control.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papersettinglist">PaperSettingList</PaperLink> — Configuration template for grouping settings and toggles.
                </PaperText>
            </PaperTextList>
        </>
    );
}
