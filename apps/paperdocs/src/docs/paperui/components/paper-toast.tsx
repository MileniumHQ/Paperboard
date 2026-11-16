import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    showError,
    showToast,
} from "@mileniumhq/paperui";

export default function PaperToastDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperToast</PaperText>
            <PaperText preset="body" as="p">
                A toast is a short message in the bottom right corner of the window: something failed or finished, said where it will be seen.
                Call <PaperCode>showToast</PaperCode> from anywhere inside a <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>, which renders the corner the toasts stack in.
                It is the way to show a failure: any button, menu item or call that fails catches the error and passes it to <PaperCode>showError</PaperCode>, with no signal to keep and no place in the layout to find.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="failures">Failures are toasts</PaperText>
            <PaperTextList>
                <li>A failure is a toast, never an error quote. <PaperCode>{'<PaperQuote variant="danger">'}</PaperCode> is deprecated, and the code check flags it.</li>
                <li>What an action couldn't do: <PaperCode>showError</PaperCode> in its catch.</li>
                <li>A failure that stands until something changes, such as settings that can't be read: <PaperCode>createFailureToast</PaperCode>, or <PaperLink href="/docs/paperui/state/#create-read">createRead</PaperLink>'s <PaperCode>failure</PaperCode>.</li>
                <li>A field's failure stays on the field, as <PaperLink href="/docs/paperui/paperinput/">PaperInput</PaperLink>'s <PaperCode>error</PaperCode>. Anything else in a dialog is a toast, which shows over the dialog while it stays open.</li>
                <li>A view with nothing to show because it couldn't load shows <PaperLink href="/docs/paperui/paperemptystate/#couldnt-load">"Couldn't load"</PaperLink> with Try again, and the toast says why. A view that still has its old data keeps it on screen, and the toast says the reload failed.</li>
                <li>A toast may repeat a button, such as Try again, but never holds the only one: a closed toast takes its button with it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" wrap>
                    <PaperButton onClick={() => showError("Couldn't save the server", new Error("The disk is full."), { retry: () => showToast({ variant: "success", title: "Server saved" }) })}>
                        Show a failure
                    </PaperButton>
                    <PaperButton onClick={() => showToast({ variant: "success", title: "Backup finished" })}>
                        Show a success
                    </PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { showError } from "@mileniumhq/paperui";

const save = () => service.calls.saveServer(draft()).catch((err) => showError("Couldn't save the server", err, { retry: save }));`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="show-error">showError</PaperText>
            <PaperCode block language="tsx">
{`showError(title: string, err: unknown, options?: { retry?: () => void; key?: string }): string;`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>title</PaperCode> says what failed, as "Couldn't …". <PaperCode>err</PaperCode> is whatever the catch got: an Error, a string, anything. The toast says its message in words, so a caller never formats one.</li>
                <li><PaperCode>retry</PaperCode> adds a Try again button that calls it. The view keeps its own way to try again.</li>
                <li><PaperCode>key</PaperCode> is the title unless given: a failure that repeats shows once, with its newest reason. It returns the toast's id.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-failure-toast">createFailureToast</PaperText>
            <PaperCode block language="tsx">
{`createFailureToast(failure: Accessor<unknown>, options: { title: string; action?: { label: string; onClick: () => void } }): void;

const [saveError, setSaveError] = createSignal<unknown>(null);
createFailureToast(saveError, { title: "Couldn't save the settings" });`}
            </PaperCode>
            <PaperTextList>
                <li>A standing failure. While <PaperCode>failure()</PaperCode> gives something (an Error, a string, whatever was caught), a danger toast shows it in words, and newer words land in the same toast. It closes when the failure clears to <PaperCode>null</PaperCode>, <PaperCode>undefined</PaperCode>, <PaperCode>false</PaperCode> or <PaperCode>""</PaperCode>.</li>
                <li>A toast the person closed stays closed until the failure's words change, or it clears and comes back.</li>
                <li>Call it where a component is created. The toast closes with the component.</li>
                <li>A read's failure needs none of this: give <PaperLink href="/docs/paperui/state/#create-read">createRead</PaperLink> its <PaperCode>failure</PaperCode> option.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="api">showToast</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>showToast(options)</PaperCode> shows any toast and returns its id. <PaperCode>dismissToast(id)</PaperCode> closes it early.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Option</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>What happened, as a short sentence such as "AI couldn't update".</td>
                    </tr>
                    <tr>
                        <td><PaperCode>message</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Why, under the title. Pass the error's message for a failure.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>variant</PaperCode></td>
                        <td><PaperCode>"danger" | "warning" | "success" | "info"</PaperCode></td>
                        <td><PaperCode>"info"</PaperCode></td>
                        <td>The icon and its color.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>icon</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The variant's icon</td>
                        <td>A Material Symbols name in place of the variant's icon.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>action</PaperCode></td>
                        <td><PaperCode>{"{ label: string; onClick: () => void }"}</PaperCode></td>
                        <td>No default</td>
                        <td>One button under the message, such as Retry. Pressing it closes the toast.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>duration</PaperCode></td>
                        <td><PaperCode>number | null</PaperCode></td>
                        <td>6000, or <PaperCode>null</PaperCode> for danger</td>
                        <td>Milliseconds before it goes by itself. <PaperCode>null</PaperCode> keeps it until it is closed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>key</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Names what the toast is about. While a toast with the same key is showing, no other is added: that toast takes the newest title, message, icon and action, and its id is returned. A failure that repeats says so once.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A danger toast stays until it is closed, so a failure is never missed. Other variants go after 6 seconds.</li>
                <li>Toasts stack with the newest at the bottom. Past five, the oldest goes first.</li>
                <li>A danger toast has the <PaperCode>alert</PaperCode> role, so screen readers announce it. Others have the <PaperCode>status</PaperCode> role.</li>
                <li>Only the outermost PaperProvider renders the corner, so a provider inside another doesn't show a toast twice. Outside a PaperProvider, render <PaperCode>{"<PaperToastRegion />"}</PaperCode> yourself.</li>
                <li>Toasts show over an open <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> and take presses there, and the dialog stays open. Tab goes from the dialog to the toasts and back in, so a toast is read and closed from the keyboard too.</li>
                <li>A panel's toasts appear in the bottom right of the panel, inside its own window.</li>
                <li>An error nothing caught shows as a danger toast by itself. See <PaperLink href="/docs/paperui/paperprovider/#uncaught-errors">PaperProvider</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
