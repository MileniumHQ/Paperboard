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
                A toast is a short message in the middle of the window, near its top: something failed or finished, said where it will be seen and where it covers no button.
                While a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> is open, it shows inside the dialog instead, above its buttons.
                Call <PaperCode>showToast</PaperCode> from anywhere inside a <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>, which renders the region the toasts stack in.
                It is the way to show a failure: any button, menu item or call that fails catches the error and passes it to <PaperCode>showError</PaperCode>, with no signal to keep and no place in the layout to find.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="failures">Failures are toasts</PaperText>
            <PaperTextList>
                <li>A failure is a toast, never an error quote. <PaperCode>{'<PaperQuote variant="danger">'}</PaperCode> is deprecated, and the code check flags it.</li>
                <li>What an action couldn't do: <PaperLink href="/docs/paperui/state/#create-action">createAction</PaperLink>'s <PaperCode>run</PaperCode>, which toasts a failure and closes it once the same action goes through, or <PaperCode>showError</PaperCode> in a catch of your own.</li>
                <li>A failure that stands until something changes, such as settings that can't be read: <PaperCode>createFailureToast</PaperCode>, or <PaperLink href="/docs/paperui/state/#create-read">createRead</PaperLink>'s <PaperCode>failure</PaperCode>.</li>
                <li>A field's failure stays on the field, as <PaperLink href="/docs/paperui/paperinput/#validation">PaperInput</PaperLink>'s <PaperCode>error</PaperCode>. Anything else in a dialog is a toast, which shows inside the dialog, above its buttons, while it stays open.</li>
                <li>Never a red line of text: <PaperCode>{'<PaperText preset="error">'}</PaperCode> and <PaperCode>{'<PaperText color="danger">'}</PaperCode> are flagged like an error quote.</li>
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
{`showError(title: string, err: unknown, options?: { retry?: () => void; key?: string; details?: string }): string;`}
            </PaperCode>
            <PaperTextList>
                <li><PaperCode>title</PaperCode> says what failed, as "Couldn't …". <PaperCode>err</PaperCode> is whatever the catch got: an Error, a string, anything. The toast says its message in words, so a caller never formats one.</li>
                <li>A toast holds one line. A reason of several lines, such as a tool's exit and what it printed, shows its first line, and the rest under Details, where it can be read whole and copied. Pass <PaperCode>details</PaperCode> to give them yourself.</li>
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
                <li>A standing failure. While <PaperCode>failure()</PaperCode> gives something (an Error, a string, whatever was caught), a danger toast shows it in words (its first line, and the rest under Details), and newer words land in the same toast. It closes when the failure clears to <PaperCode>null</PaperCode>, <PaperCode>undefined</PaperCode>, <PaperCode>false</PaperCode> or <PaperCode>""</PaperCode>.</li>
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
                        <td><PaperCode>details</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Anything longer than a line, such as what a tool printed. It folds under Details, scrolls when it is long, and has a copy button.</td>
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
                <li>Toasts show in the middle of the window, and take its whole width on a phone. They sit as near the top as they can while they cover no button, field or link the page shows (a header's name, a bar's Back, a wizard's Finish, a composer's Send), sliding down past each one in their way, or else along the bottom. They look again as toasts come and go, a dialog opens or closes, the page changes or the window is resized, and stay put while where they are still covers nothing.</li>
                <li>Toasts stack with the newest at the bottom. Past five, the oldest goes first.</li>
                <li>A danger toast has the <PaperCode>alert</PaperCode> role, so screen readers announce it. Others have the <PaperCode>status</PaperCode> role.</li>
                <li>Only the outermost PaperProvider renders the region, so a provider inside another doesn't show a toast twice. Outside a PaperProvider, render <PaperCode>{"<PaperToastRegion />"}</PaperCode> yourself.</li>
                <li>While a <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> is open, its toasts show inside the top dialog, between its content and its footer, and take room of their own: the content scrolls to make it, and the buttons stay where they are. Tab reaches them in the dialog's own order.</li>
                <li>When the dialog closes, its toasts go back to the page, the same toasts: a failure is never lost with the dialog it was said in.</li>
                <li>Over any other dialog (such as <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink>), toasts show above the scrim and take presses there, and Tab goes from the dialog to the toasts and back in.</li>
                <li>A panel's toasts appear in its own window, placed the same way.</li>
                <li>An error nothing caught shows as a danger toast by itself. See <PaperLink href="/docs/paperui/paperprovider/#uncaught-errors">PaperProvider</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
