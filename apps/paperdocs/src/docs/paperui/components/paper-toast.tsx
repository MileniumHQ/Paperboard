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
                A toast is a short message in the window's bottom-right corner: something that failed or finished just now, said where it will be seen.
                Call <PaperCode>showToast</PaperCode> from anywhere inside a <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>, which renders the region the toasts stack in.
                Every toast goes by itself, and a thin line along its bottom shrinks with the time it has left.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="failures">A toast or a PaperError</PaperText>
            <PaperTextList>
                <li>A one-off failure is a toast: an action or a save that didn't go through. Catch the error and pass it to <PaperCode>showError</PaperCode>, or run it with <PaperLink href="/docs/paperui/state/#create-action">createAction</PaperLink>, which toasts a failure and closes it once the same action goes through.</li>
                <li>A failure that stands is a <PaperLink href="/docs/paperui/papererror/">PaperError</PaperLink> where it happens, never a toast: a view that won't load, a setup that failed, a service that refused. A toast goes, and the failure would stay with nothing saying so.</li>
                <li>A field's failure stays on the field, as <PaperLink href="/docs/paperui/paperinput/#validation">PaperInput</PaperLink>'s <PaperCode>error</PaperCode>.</li>
                <li>Never an error quote or a red line of text: <PaperCode>{'<PaperQuote variant="danger">'}</PaperCode>, <PaperCode>{'<PaperText preset="error">'}</PaperCode> and <PaperCode>{'<PaperText color="danger">'}</PaperCode> are flagged by the code check.</li>
                <li>A toast may repeat a button, such as Try again, but never holds the only one: a toast that is gone takes its button with it.</li>
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
                <li><PaperCode>key</PaperCode> is the title unless given: a failure that repeats shows once, with its newest reason, and its time starts again. It returns the toast's id.</li>
                <li>It goes after 10 seconds, like every danger toast.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="create-failure-toast">createFailureToast (deprecated)</PaperText>
            <PaperText preset="body" as="p">
                Deprecated: a failure that stands is a <PaperLink href="/docs/paperui/papererror/">PaperError</PaperLink> in place. A toast goes by itself, so it can't hold a failure that stays. It still works while panels move off it.
            </PaperText>
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
                        <td>Anything longer than a line, such as what a tool printed. It folds under Details, wraps its long lines, scrolls when it is long, and has a copy button.</td>
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
                        <td><PaperCode>number</PaperCode></td>
                        <td>10000 for danger and warning, 6000 for the rest</td>
                        <td>Milliseconds before it goes by itself. Every toast goes: there is no way to keep one, and the code check flags <PaperCode>duration: null</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>key</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Names what the toast is about. While a toast with the same key is showing, no other is added: that toast takes the newest title, message, icon and action, its time starts again, and its id is returned. A failure that repeats says so once.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>Every toast goes by itself: danger and warning after 10 seconds, the rest after 6. Its close button closes it sooner.</li>
                <li>A thin line lies along the toast's whole bottom edge, over its border and round its corners, in the variant's color, red for danger. It is cut back from the end to nothing over the time left.</li>
                <li>Pointing at a toast, or focusing anything in it, holds its time and its line. Leaving lets both run on from where they were, so a toast being read or used never goes from under the person. A toast that shows up under a pointer resting there still goes in its time.</li>
                <li>Under reduced motion the line steps down in five still moves instead of gliding, and the time is the same.</li>
                <li>Toasts sit in the window's bottom-right corner, over everything, an open <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> included, and take its whole width on a phone. They stack with the newest at the bottom. Past five, the oldest goes first.</li>
                <li>While a dialog is open, Tab goes from the dialog to the toasts and back in, never to the page under the scrim.</li>
                <li>A danger toast has the <PaperCode>alert</PaperCode> role, so screen readers announce it. Others have the <PaperCode>status</PaperCode> role.</li>
                <li>Only the outermost PaperProvider renders the region, so a provider inside another doesn't show a toast twice. Outside a PaperProvider, render <PaperCode>{"<PaperToastRegion />"}</PaperCode> yourself.</li>
                <li>A panel's toasts appear in its own window, placed the same way.</li>
                <li>An error nothing caught shows as a danger toast by itself. See <PaperLink href="/docs/paperui/paperprovider/#uncaught-errors">PaperProvider</PaperLink>.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
