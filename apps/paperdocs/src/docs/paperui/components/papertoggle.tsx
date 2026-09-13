import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperToggle,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [isEnabled, setIsEnabled] = createSignal(true);
    const [autoSave, setAutoSave] = createSignal(false);

    return (
        <>
            <PaperText preset="header">PaperToggle</PaperText>
            <PaperText preset="body">
                <strong>PaperToggle</strong> is a binary switch input primitive featuring an animated sliding knob, integrated status icons, keyboard accessibility, and reactive state synchronization.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperToggle implements an accessible boolean switch control (<PaperCode>role="switch"</PaperCode>). It supports both controlled and uncontrolled states, an animated sliding knob, keyboard toggling via <PaperCode>Space</PaperCode> and <PaperCode>Enter</PaperCode>, and embedded check/close icon glyphs.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Toggles can be bound to reactive signals using the <PaperCode>checked</PaperCode> and <PaperCode>onChange</PaperCode> props:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperToggle, PaperFlex, PaperText } from "@paperboard-dev/paperui";

function ToggleExample() {
    const [active, setActive] = createSignal(true);

    return (
        <PaperFlex direction="row" align="center" gap="full">
            <PaperToggle checked={active()} onChange={setActive} />
            <PaperText preset="body">
                Service status: {active() ? "Active" : "Disabled"}
            </PaperText>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full" center>
                    <PaperFlex direction="row" align="center" gap="full">
                        <PaperToggle
                            checked={isEnabled()}
                            onChange={(val) => setIsEnabled(val)}
                        />
                        <PaperText preset="body">
                            Feature flag is currently: <strong>{isEnabled() ? "ENABLED" : "DISABLED"}</strong>
                        </PaperText>
                    </PaperFlex>

                    <PaperFlex direction="row" align="center" gap="full">
                        <PaperToggle
                            checked={autoSave()}
                            onChange={(val) => setAutoSave(val)}
                        />
                        <PaperText preset="body">
                            Auto-save to cloud storage: <strong>{autoSave() ? "ON" : "OFF"}</strong>
                        </PaperText>
                    </PaperFlex>

                    <PaperFlex direction="row" align="center" gap="full">
                        <PaperToggle disabled checked={true} />
                        <PaperText preset="body" color="var(--paper-light-text)">
                            Disabled toggle state
                        </PaperText>
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
                        <td>Controlled boolean state bound to an external reactive signal.</td>
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
                        <td><PaperCode>showIcons</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Renders check and close glyphs inside the sliding switch knob.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Deactivates toggling and renders the switch in a muted state.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papersettinglist">PaperSettingList</PaperLink> — Configuration template frequently incorporating PaperToggle.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperselector">PaperSelector</PaperLink> — Multi-option radio selection control.
                </PaperText>
            </PaperTextList>
        </>
    );
}
