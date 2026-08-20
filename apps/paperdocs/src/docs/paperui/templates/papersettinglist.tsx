import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
    PaperTextList,
    PaperToggle,
} from "paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [settings, setSettings] = createSignal<Record<string, any>>({
        notifications: true,
        displayName: "Core Studio",
        telemetry: false,
    });

    return (
        <>
            <PaperText preset="header">PaperSettingList</PaperText>
            <PaperText preset="body">
                <strong>PaperSettingList</strong> is a standardized form and settings layout template that uses event delegation to automatically harvest key-value configuration state across nested form controls.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                <strong>PaperSettingList</strong> and <strong>PaperSettingItem</strong> provide a unified two-column layout for application settings and configuration panels. By intercepting bubbling <PaperCode>input</PaperCode> and <PaperCode>change</PaperCode> events on the parent list, <PaperCode>PaperSettingList</PaperCode> automatically captures values from any child input element possessing a <PaperCode>name</PaperCode> attribute.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and Demonstration
            </PaperText>
            <PaperText preset="body">
                Each child input control (<PaperLink href="/paperui/papertoggle"><PaperCode>PaperToggle</PaperCode></PaperLink>, <PaperLink href="/paperui/paperinput"><PaperCode>PaperInput</PaperCode></PaperLink>, etc.) specifies a <PaperCode>name</PaperCode> attribute matching the corresponding key in the data object:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { createSignal } from "solid-js";
import { PaperSettingList, PaperSettingItem, PaperToggle, PaperInput } from "paperui";

function ConfigurationPanel() {
    const [config, setConfig] = createSignal({
        darkMode: true,
        username: "admin",
    });

    return (
        <PaperSettingList
            value={config()}
            onValueChange={(updated) => setConfig(updated)}
        >
            <PaperSettingItem
                title="Dark Theme"
                description="Enable dark mode across the application."
            >
                <PaperToggle name="darkMode" checked={config().darkMode} />
            </PaperSettingItem>

            <PaperSettingItem
                title="Display Name"
                description="Public profile identifier."
            >
                <PaperInput name="username" value={config().username} />
            </PaperSettingItem>
        </PaperSettingList>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" gap="full">
                    <PaperSettingList
                        value={settings()}
                        onValueChange={(updated) => setSettings(updated)}
                    >
                        <PaperSettingItem
                            title="System Notifications"
                            description="Receive desktop alerts when background jobs complete."
                        >
                            <PaperToggle name="notifications" checked={settings().notifications} />
                        </PaperSettingItem>

                        <PaperSettingItem
                            title="Workspace Name"
                            description="Identifies this instance within the local network."
                        >
                            <PaperInput name="displayName" value={settings().displayName} compact />
                        </PaperSettingItem>

                        <PaperSettingItem
                            title="Telemetry & Diagnostics"
                            description="Transmit anonymous performance diagnostics."
                        >
                            <PaperToggle name="telemetry" checked={settings().telemetry} />
                        </PaperSettingItem>
                    </PaperSettingList>

                    <PaperSeparator />

                    <PaperFlex gap="onefourth">
                        <PaperText size={2} weight={700}>Harvested Configuration State:</PaperText>
                        <PaperCode block language="json">
                            {JSON.stringify(settings(), null, 2)}
                        </PaperCode>
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="specification" preset="subheader">
                Technical Specification
            </PaperText>

            <PaperText id="props-list" preset="title">
                PaperSettingList Props
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
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Controlled key-value configuration state object.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>Record&lt;string, any&gt;</PaperCode></td>
                        <td><PaperCode>&#123;&#125;</PaperCode></td>
                        <td>Uncontrolled initial configuration dictionary.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(values: Record&lt;string, any&gt;) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Callback executed whenever any nested named input dispatches change/input.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText id="props-item" preset="title">
                PaperSettingItem Props
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
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><em>Required</em></td>
                        <td>Primary setting label rendered in bold text on the left column.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>description</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Secondary descriptive prose explaining the setting purpose.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Renders the setting item in an inactive, desaturated visual state.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>The interactive input control (toggle, input, select) rendered in the right column.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See Also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertoggle">PaperToggle</PaperLink> — Switch primitive commonly embedded in setting items.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperinput">PaperInput</PaperLink> — Text input primitive compatible with setting item forms.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperlist">PaperList</PaperLink> — Single-selection list component with reordering support.
                </PaperText>
            </PaperTextList>
        </>
    );
}
