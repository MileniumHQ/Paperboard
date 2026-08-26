import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperLink,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperTable,
    PaperText,
} from "paperui";

export default function f() {
    return (
        <>
            <PaperText preset="header">PaperSelectMenu</PaperText>
            <PaperText preset="body">
                <strong>PaperSelectMenu</strong> is a dropdown selection primitive
                that mirrors the behavior of the native HTML{" "}
                <PaperCode>&lt;select&gt;</PaperCode> element while rendering
                entirely through PaperUI components. It shares its selection
                machinery with PaperSelector, PaperRail, and PaperMenu.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                The component renders a trigger button showing the active option
                and opens a popup list of options. Selection follows radio
                semantics: exactly one value is active, controlled through the
                standard <PaperCode>value</PaperCode>,{" "}
                <PaperCode>defaultValue</PaperCode>, and{" "}
                <PaperCode>onValueChange</PaperCode> props shared by all
                selection containers.
            </PaperText>

            <PaperQuote variant="blue" icon="info" title="Form integration">
                When given a <PaperCode>name</PaperCode>, the menu carries a
                hidden input and dispatches bubbling change and input events on
                selection. Containers such as PaperSettingList capture values
                without any wiring.
            </PaperQuote>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage
            </PaperText>
            <PaperCode block language="tsx">
                {`<PaperSelectMenu name="theme" value={theme()} onValueChange={setTheme}>
    <PaperSelectMenuItem value="system" icon="contrast">
        System
    </PaperSelectMenuItem>
    <PaperSelectMenuItem value="light" icon="light_mode">
        Light
    </PaperSelectMenuItem>
    <PaperSelectMenuItem value="dark" icon="dark_mode">
        Dark
    </PaperSelectMenuItem>
</PaperSelectMenu>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex direction="row" gap="half" padding="full" wrap>
                    <PaperSelectMenu name="demo-theme" defaultValue="system">
                        <PaperSelectMenuItem value="system" icon="contrast">
                            System
                        </PaperSelectMenuItem>
                        <PaperSelectMenuItem value="light" icon="light_mode">
                            Light
                        </PaperSelectMenuItem>
                        <PaperSelectMenuItem value="dark" icon="dark_mode">
                            Dark
                        </PaperSelectMenuItem>
                    </PaperSelectMenu>
                    <PaperSelectMenu name="demo-region" placeholder="Region…">
                        <PaperSelectMenuItem value="eu">Europe</PaperSelectMenuItem>
                        <PaperSelectMenuItem value="na">
                            North America
                        </PaperSelectMenuItem>
                        <PaperSelectMenuItem value="apac" disabled>
                            Asia-Pacific (unavailable)
                        </PaperSelectMenuItem>
                    </PaperSelectMenu>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="keyboard" preset="subheader">
                Keyboard interaction
            </PaperText>
            <PaperText preset="body">
                Enter and Space open the popup or commit the highlighted option;
                ArrowUp and ArrowDown move the highlight; Home and End jump to
                the first or last option; Escape closes without selecting.
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
                        <td><PaperCode>name</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>required</td>
                        <td>Selection group identifier and form field name.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Controlled active value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Initial value for uncontrolled usage.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onValueChange</PaperCode></td>
                        <td><PaperCode>(value) =&gt; void</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Fires when an option is committed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>placeholder</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>"Select…"</td>
                        <td>Trigger text when no option is active.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Blocks opening and selecting.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Stretches the trigger to fill its container.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="body">
                Options (<PaperCode>PaperSelectMenuItem</PaperCode>) accept{" "}
                <PaperCode>value</PaperCode> (required), optional{" "}
                <PaperCode>icon</PaperCode>, optional{" "}
                <PaperCode>disabled</PaperCode>, and children as their label.
                The selected option displays a check mark inside the popup.
            </PaperText>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/paperselector">PaperSelector</PaperLink> — Segmented control exposing all options at once.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papersettinglist">PaperSettingList</PaperLink> — Settings layout that captures select values automatically.
                </PaperText>
            </PaperTextList>
        </>
    );
}
