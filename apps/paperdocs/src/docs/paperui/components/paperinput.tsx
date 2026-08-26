import {
    PaperCode,
    PaperContainer,
    PaperFlex,
    PaperInput,
    PaperLink,
    PaperSeparator,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@paperboard-dev/paperui";
import { createSignal } from "solid-js";

export default function f() {
    const [email, setEmail] = createSignal("");

    return (
        <>
            <PaperText preset="header">PaperInput</PaperText>
            <PaperText preset="body">
                <strong>PaperInput</strong> is a single-line textual data entry primitive in PaperUI featuring integrated icon prefixes, validation predicates, compact sizing modifiers, full-width layouts, and accessible form event bindings.
            </PaperText>
            <PaperSeparator />

            <PaperText id="overview" preset="subheader">
                Overview
            </PaperText>
            <PaperText preset="body">
                PaperInput provides an accessible text entry field conforming to PaperUI design tokens. It supports controlled and uncontrolled operation, leading iconography, real-time input validation predicates, focus states, and invalid boundary indication using <PaperCode>--paper-front-red</PaperCode> accents.
            </PaperText>

            <PaperSeparator />

            <PaperText id="usage" preset="subheader">
                Usage and demonstration
            </PaperText>
            <PaperText preset="body">
                Input fields can be customized with prefix icons, compact sizing, and full-width layouts:
            </PaperText>

            <PaperCode block language="tsx">
                {`import { PaperInput, PaperFlex } from "@paperboard-dev/paperui";

function InputShowcase() {
    return (
        <PaperFlex gap="full">
            <PaperInput placeholder="Standard text input..." />
            <PaperInput icon="search" placeholder="Search resources..." />
            <PaperInput icon="mail" compact placeholder="user@domain.com" />
            <PaperInput fullWidth icon="edit" placeholder="Full width text field..." />
            <PaperInput
                icon="lock"
                type="password"
                placeholder="Enter passphrase..."
            />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <PaperFlex gap="full" style={{ width: "100%", "max-width": "380px" }}>
                        <PaperInput placeholder="Standard text input..." />
                        <PaperInput icon="search" placeholder="Search resources..." />
                        <PaperInput icon="mail" compact placeholder="user@domain.com" />
                        <PaperInput fullWidth icon="edit" placeholder="Full width text field..." />
                        <PaperInput icon="lock" type="password" placeholder="Enter passphrase..." />
                    </PaperFlex>
                </PaperFlex>
            </PaperContainer>

            <PaperSeparator />

            <PaperText id="validation" preset="subheader">
                Real-time validation
            </PaperText>
            <PaperText preset="body">
                Supplying a <PaperCode>validate</PaperCode> predicate function automatically sets the input's invalid error visual state when evaluating to false. An explicit <PaperCode>invalid</PaperCode> prop takes precedence: when set, it overrides the <PaperCode>validate</PaperCode> predicate entirely.
            </PaperText>

            <PaperCode block language="tsx">
                {`// Validates that the input contains an "@" symbol and a period
<PaperInput
    icon="alternate_email"
    placeholder="Validate email..."
    validate={(val) => val.includes("@") && val.includes(".")}
/>`}
            </PaperCode>

            <PaperContainer>
                <PaperFlex padding="full" center>
                    <div style={{ width: "100%", "max-width": "380px" }}>
                        <PaperInput
                            icon="alternate_email"
                            placeholder="Validate email format..."
                            value={email()}
                            onInput={(e) => setEmail(e.currentTarget.value)}
                            validate={(val) => !val || (val.includes("@") && val.includes("."))}
                        />
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
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string | JSX.Element</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Leading icon glyph name or element rendered inside the input track.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>compact</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Reduces padding and height for high-density forms and toolbars.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fullWidth</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Expands the input width to span 100% of its parent container.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>invalid</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Explicitly sets the invalid error visual state and accent border color. When set, overrides the <PaperCode>validate</PaperCode> predicate entirely.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>validate</PaperCode></td>
                        <td><PaperCode>(value: string) =&gt; boolean</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Predicate returning false when input text fails validation rules. Ignored when <PaperCode>invalid</PaperCode> is explicitly set.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>defaultValue</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Initial uncontrolled value. When omitted, the internal state falls back to an empty string.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>value</PaperCode></td>
                        <td><PaperCode>string | number</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Controlled value bound to an external reactive signal.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>type</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"text"</PaperCode></td>
                        <td>Native HTML input type (such as <PaperCode>"text"</PaperCode>, <PaperCode>"password"</PaperCode>, <PaperCode>"email"</PaperCode>).</td>
                    </tr>
                    <tr>
                        <td><PaperCode>disabled</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Disables user interaction and applies muted opacity.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td><PaperCode>HTMLInputElement | ((el: HTMLInputElement) =&gt; void)</PaperCode></td>
                        <td><PaperCode>undefined</PaperCode></td>
                        <td>Receives the underlying native <PaperCode>&lt;input&gt;</PaperCode> element.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperSeparator />

            <PaperText id="see-also" preset="subheader">
                See also
            </PaperText>
            <PaperTextList>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papersettinglist">PaperSettingList</PaperLink> — Configuration template leveraging named PaperInput controls.
                </PaperText>
                <PaperText preset="body">
                    <PaperLink href="/paperui/papertoggle">PaperToggle</PaperLink> — Binary switch control.
                </PaperText>
            </PaperTextList>
        </>
    );
}
