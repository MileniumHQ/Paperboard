import {
    PaperCard,
    PaperCode,
    PaperError,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperErrorDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperError</PaperText>
            <PaperText preset="body" as="p">
                PaperError says a failure that stands, where it happens: a view that won't load, a setup that failed, a service that refused.
                It says what failed, why, and what to do about it, and stays until the failure is gone.
                A one-off failure, such as a save that didn't go through, is a <PaperLink href="/docs/paperui/papertoast/#failures">toast</PaperLink> instead.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass a <PaperCode>title</PaperCode> that says what failed, and the caught error as <PaperCode>error</PaperCode>. It says the error in words, so a caller never formats one.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperError
                    title="Couldn't load the newest backups"
                    error={new Error("The backup folder is on a drive that isn't connected")}
                    action={{ label: "Try again", onClick: () => undefined }}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { Show } from "solid-js";
import { createRead, PaperError } from "@mileniumhq/paperui";

const backups = createRead(() => service.calls.listBackups());

<Show when={backups.error()}>
    {(err) => (
        <PaperError
            title="Couldn't load the newest backups"
            error={err()}
            action={{ label: "Try again", onClick: () => void backups.reload() }}
        />
    )}
</Show>`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperText preset="body" as="p">
                PaperErrorProps extends <PaperCode>JSX.HTMLAttributes&lt;HTMLDivElement&gt;</PaperCode> without <PaperCode>title</PaperCode>, which is the failure's name here.
                Other props land on the root <PaperCode>div</PaperCode>.
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
                        <td><PaperCode>title</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (required)</td>
                        <td>What failed, short, as "Couldn't …": "Couldn't load the worlds". It names the region for a screen reader too.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>error</PaperCode></td>
                        <td><PaperCode>unknown</PaperCode></td>
                        <td>No default (no reason)</td>
                        <td>Whatever was caught: an Error, a string, anything. Its first line is the reason, under the title. The lines after it fold under Details.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>details</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>The error's other lines</td>
                        <td>Anything longer, such as what a tool printed. It folds under Details, scrolls when it is long, and has a copy button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>action</PaperCode></td>
                        <td><PaperCode>{"{ label: string; onClick: () => void; disabled?: boolean }"}</PaperCode></td>
                        <td>No default</td>
                        <td>One button under the reason: Try again, Open settings. <PaperCode>disabled</PaperCode> holds it while what it started is still going, such as a read it repeats.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fill</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Fills a view that has nothing else to show, centred in the space left. Without it the error sits in line.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>alert</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>It appeared because of what the person just did, so a screen reader says it at once. Without it, it is a region named by its title, read when it is reached.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>One red signal, its icon. The title and reason are in the type every PaperUI title and description uses, so a failure reads as calmly as the page around it.</li>
                <li>In line, it is a row in a hairline frame: the icon beside the words, the button under them. Long reasons, paths and links wrap.</li>
                <li>Its role is <PaperCode>region</PaperCode>, named by its title, unless <PaperCode>alert</PaperCode> makes it an <PaperCode>alert</PaperCode>. Use <PaperCode>alert</PaperCode> only when it appears after a press: an error that is there when a view opens isn't news.</li>
                <li>It holds no state. It shows while you render it: put it under a <PaperCode>Show</PaperCode> on the failure, and it goes when the failure does.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="fill">A view that couldn't load</PaperText>
            <PaperText preset="body" as="p">
                A view with nothing to show because it couldn't load never leaves its body blank: <PaperCode>fill</PaperCode> puts the failure in the middle of it, with Try again.
                A view that still has its old data keeps it on screen, with an inline PaperError above it.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperError
                    fill
                    title="Couldn't load the worlds"
                    error={new Error("The server didn't answer: connection refused on port 25575")}
                    action={{ label: "Try again", onClick: () => undefined }}
                />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { Match, Switch } from "solid-js";
import { createRead, PaperError, PaperLoader } from "@mileniumhq/paperui";

const worlds = createRead(() => service.calls.listWorlds());

<Switch>
    <Match when={worlds.value()}>{(list) => <WorldList worlds={list()} />}</Match>
    <Match when={worlds.error()}>
        {(err) => (
            <PaperError
                fill
                title="Couldn't load the worlds"
                error={err()}
                action={{ label: "Try again", disabled: worlds.loading(), onClick: () => void worlds.reload() }}
            />
        )}
    </Match>
    <Match when={true}>
        <PaperLoader loaderStatus="indeterminate" label="Reading worlds" />
    </Match>
</Switch>`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="details">What a tool printed</PaperText>
            <PaperText preset="body" as="p">
                A reason of several lines shows its first line, and the rest under Details, where it can be read whole and copied.
            </PaperText>
            <PaperCard data-docs-demo surface="front">
                <PaperError
                    title="Couldn't install the Palworld server"
                    error={"SteamCMD exited with code 8\nLogging in anonymously...\nERROR! Failed to install app '2394010' (Disk write failure)"}
                    action={{ label: "Open settings", onClick: () => undefined }}
                />
            </PaperCard>

            <PaperText preset="subheader" as="h3" id="choosing">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>A failure that stands: PaperError, where it happens.</li>
                <li>An action or a save that failed: <PaperLink href="/docs/paperui/papertoast/#show-error">showError</PaperLink>, or <PaperLink href="/docs/paperui/state/#create-action">createAction</PaperLink>.</li>
                <li>A field typed wrong: <PaperLink href="/docs/paperui/paperinput/#validation">PaperInput</PaperLink>'s <PaperCode>error</PaperCode>.</li>
                <li>Nothing here yet, with nothing wrong: <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink>.</li>
                <li>Never <PaperCode>{'<PaperQuote variant="danger">'}</PaperCode> or a red line of text: the code check flags both.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
