import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    showToast,
} from "@mileniumhq/paperui";

export default function PaperToastDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperToast</PaperText>
            <PaperText preset="body" as="p">
                A toast is a short message in the bottom right corner of the window: something failed or finished, said where it will be seen.
                Call <PaperCode>showToast</PaperCode> from anywhere inside a <PaperLink href="/docs/paperui/paperprovider/">PaperProvider</PaperLink>, which renders the corner the toasts stack in.
                It is the way to show a failure: any button, menu item or call that fails catches the error and passes it here, with no signal to keep and no place in the layout to find.
                A failure that stays true until something changes, such as settings that can't be read, belongs in the page with a <PaperLink href="/docs/paperui/paperquote/">PaperQuote</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="row" gap="full" wrap>
                    <PaperButton onClick={() => showToast({ variant: "danger", title: "AI couldn't update", message: "The registry could not be reached." })}>
                        Show a failure
                    </PaperButton>
                    <PaperButton onClick={() => showToast({ variant: "success", title: "Backup finished" })}>
                        Show a success
                    </PaperButton>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { showToast } from "@mileniumhq/paperui";

try {
    await startServer();
} catch (err) {
    showToast({
        variant: "danger",
        title: "Server didn't start",
        message: err instanceof Error ? err.message : String(err),
        action: { label: "Retry", onClick: () => void startServer() },
    });
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>showToast(options)</PaperCode> shows a toast and returns its id. <PaperCode>dismissToast(id)</PaperCode> closes it early.
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
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>A danger toast stays until it is closed, so a failure is never missed. Other variants go after 6 seconds.</li>
                <li>Toasts stack with the newest at the bottom. Past five, the oldest goes first.</li>
                <li>A danger toast has the <PaperCode>alert</PaperCode> role, so screen readers announce it. Others have the <PaperCode>status</PaperCode> role.</li>
                <li>Only the outermost PaperProvider renders the corner, so a provider inside another doesn't show a toast twice. Outside a PaperProvider, render <PaperCode>{"<PaperToastRegion />"}</PaperCode> yourself.</li>
                <li>A panel's toasts appear in the bottom right of the panel, inside its own window.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
