import {
    PaperCard,
    PaperCode,
    PaperCopyButton,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperCopyButtonDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperCopyButton</PaperText>
            <PaperText preset="body" as="p">
                PaperCopyButton copies a string to the clipboard and shows whether the copy worked.
                Use it beside an ID, a URL, or a command that the user needs to paste elsewhere.
                It is a <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink> with the clipboard handling built in.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the string in <PaperCode>text</PaperCode>.
                Without a <PaperCode>label</PaperCode> the button is a small icon-only button, so give it a <PaperCode>title</PaperCode> that says what it copies.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" align="center">
                    <PaperCopyButton text="123456789012345678" title="Copy server ID" />
                    <PaperCopyButton text="123456789012345678" label="Copy ID" />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperCard, PaperCopyButton, PaperFlex } from "@mileniumhq/paperui";

export function Example() {
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="row" gap="full" align="center">
                <PaperCopyButton text="123456789012345678" title="Copy server ID" />
                <PaperCopyButton text="123456789012345678" label="Copy ID" />
            </PaperFlex>
        </PaperCard>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperCopyButtonProps extends <PaperCode>JSX.ButtonHTMLAttributes&lt;HTMLButtonElement&gt;</PaperCode> without <PaperCode>onClick</PaperCode>, which the component owns.
                Other props pass through to the underlying PaperButton.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>text</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required, no default</td>
                        <td>The string copied. It is read at the moment of the click.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (icon-only)</td>
                        <td>Text beside the icon. With a label the button is medium and has a text label; without one it is a tiny icon button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>"Copy"</PaperCode></td>
                        <td>Tooltip, and the accessible name of the icon-only button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>PaperButtonVariant</PaperCode></td>
                        <td>No default</td>
                        <td>Passed to PaperButton, which draws the neutral surface button without it. See <PaperLink href="/docs/paperui/paperbutton/">PaperButton</PaperLink> for the values.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode>, <PaperCode>classList</PaperCode></td>
                        <td>Solid props</td>
                        <td>No default</td>
                        <td>Added to the button.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A click copies <PaperCode>text</PaperCode> with the async clipboard API, then falls back to a temporary textarea and <PaperCode>document.execCommand("copy")</PaperCode> where the API is denied, such as a panel frame without clipboard permission.</li>
                <li>On success the icon becomes a check, and the tooltip (or the label, when there is one) reads <PaperCode>Copied</PaperCode> for 2 seconds.</li>
                <li>On failure the icon becomes an error mark and the same slot reads <PaperCode>Couldn't copy</PaperCode> for 2 seconds. The button never claims success when the copy was rejected. The failure is also logged to the console.</li>
                <li>Success and failure play the matching haptic on touch devices.</li>
                <li>The component has no callback for the outcome. Do not rely on a copy having happened for your own state.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="in-a-row">Beside an identifier</PaperText>
            <PaperText preset="body" as="p">
                The botcreator and gameserver panels place an icon-only copy button after an ID or UUID.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperCopyButton, PaperFlex, PaperText } from "@mileniumhq/paperui";

export function PlayerId(props: { uuid: string }) {
    return (
        <PaperFlex direction="row" gap="half" align="center">
            <PaperText preset="body" family="code">{props.uuid}</PaperText>
            <PaperCopyButton text={props.uuid} title="Copy UUID" />
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperText preset="body" as="p">
                A code block already has its own copy button: set <PaperCode>copyable</PaperCode> on <PaperLink href="/docs/paperui/papercode/">PaperCode</PaperLink>.
                Use PaperCopyButton for anything else that holds a string.
            </PaperText>
        </PaperFlex>
    );
}
