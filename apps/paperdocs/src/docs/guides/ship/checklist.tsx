import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ChecklistDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Panel checklist</PaperText>
            <PaperText preset="body" as="p">
                Go through this list before you pack a release or send a panel to the Paperboard team.
                It holds a panel to the rules the first-party panels follow, and each part links to the guide that shows how.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="before-you-start">Before you start</PaperText>
            <PaperText preset="body" as="p">
                A built panel linked into a test Paperboard, as in <PaperLink href="/docs/guides/dev-loop/#test-paperboard">Work on a second Paperboard</PaperLink>, so you can make failures happen without touching your own data.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="commands">The commands pass</PaperText>
            <PaperTextList>
                <li><PaperCode>bun run build</PaperCode> finishes with no type errors.</li>
                <li><PaperCode>bun test</PaperCode> passes, with the scaffold's <PaperCode>test/hermetic.ts</PaperCode> preload and <PaperCode>test/uiStandards.test.ts</PaperCode> in place. See <PaperLink href="/docs/guides/testing/">Test a panel</PaperLink>.</li>
                <li>The end-to-end tests, if the panel has them, pass against a test Paperboard.</li>
                <li><PaperCode>bunx paperapi doctor</PaperCode> ends with <PaperCode>Ready: Paperboard can run this panel.</PaperCode></li>
                <li><PaperCode>bunx paperapi pack</PaperCode> makes the archive without an error.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="manifest">The manifest</PaperText>
            <PaperTextList>
                <li>The id is reverse DNS for a name you control, such as <PaperCode>dev.example.weather</PaperCode>. It never changes after the first release. See <PaperLink href="/docs/paperapi/manifest/#panel-id">Panel id</PaperLink>.</li>
                <li><PaperCode>name</PaperCode> is short and says what the panel is. <PaperCode>description</PaperCode> is one sentence about what a person gets.</li>
                <li><PaperCode>version</PaperCode> is higher than the last release.</li>
                <li><PaperCode>publisher</PaperCode> names you.</li>
                <li><PaperCode>icon</PaperCode> points at <PaperCode>branding/icon.png</PaperCode>, a square PNG. See <PaperLink href="/docs/guides/packaging/#icon">Give it an icon</PaperLink>.</li>
                <li><PaperCode>store/about.md</PaperCode> says what the panel does and what it needs, with the scaffold's placeholder text replaced. See <PaperLink href="/docs/paperapi/store-listing/">Store listing</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="interface">The interface</PaperText>
            <PaperTextList>
                <li>Built from PaperUI components and props. No inline styles, no pixel or rem values, no <PaperCode>var(--paper-...)</PaperCode> in TypeScript: <PaperCode>getVarCss()</PaperCode> instead. See <PaperLink href="/docs/guides/ui/">Design the interface</PaperLink>.</li>
                <li>Every page looks right in the light and the dark theme, and in the phone layout below 520 pixels wide.</li>
                <li>Every modal is mounted all the time and opened with <PaperCode>open</PaperCode>. Nothing uses <PaperCode>alert</PaperCode>, <PaperCode>confirm</PaperCode> or <PaperCode>prompt</PaperCode>.</li>
                <li>Anything that deletes or can't be undone asks first, with a danger button that says what it does.</li>
                <li>A button that runs something is disabled while it runs.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="failures">Failures</PaperText>
            <PaperTextList>
                <li>Every button, form and action shows its failure with the reason, where the person was looking. See <PaperLink href="/docs/guides/errors/">Show every failure</PaperLink>.</li>
                <li>Work in the background puts its failures in the state, and the page shows them.</li>
                <li>A service that can't load its settings keeps running and says so on the page.</li>
                <li>Nothing shows a placeholder or a zero in place of something missing.</li>
                <li>Every thrown message is a sentence a person can act on.</li>
                <li>Try it: stop the network, remove a key, enter too much text, and look at every page and widget.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="data-and-secrets">Data and secrets</PaperText>
            <PaperTextList>
                <li>Keys, tokens and passwords are in <PaperCode>secretsApi</PaperCode> only: never in config, files, the state, an action's inputs or results, or the log. See <PaperLink href="/docs/guides/settings-and-secrets/">Settings and secrets</PaperLink>.</li>
                <li>One writer per config document, usually the service.</li>
                <li>Settings and state survive <PaperCode>bunx paperapi restart</PaperCode>.</li>
                <li>Nothing the panel does on stop, update or uninstall deletes the person's data.</li>
                <li>A service that holds data in memory or runs a program that writes files gets ready in <PaperCode>beforeBackup</PaperCode>.</li>
                <li>Tests never reach <PaperCode>~/.paperboard</PaperCode>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="actions">Actions and widgets</PaperText>
            <PaperTextList>
                <li>Every public action has a <PaperCode>description</PaperCode> an agent can decide from, a <PaperCode>template</PaperCode>, and a <PaperCode>category</PaperCode> named after the panel. See <PaperLink href="/docs/guides/actions/">Expose actions</PaperLink>.</li>
                <li>Every input has a limit, and every <PaperCode>placeholder</PaperCode> names the kind of value: <PaperCode>City</PaperCode>, not <PaperCode>Oslo</PaperCode>.</li>
                <li>Actions only the panel's pages call are <PaperCode>internal</PaperCode>.</li>
                <li>A trigger fires once per change, not on every check.</li>
                <li>Every widget shows one fact, and says what is wrong when it can't. See <PaperLink href="/docs/guides/widgets/">Add a Home widget</PaperLink>.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>The panel works the same for every person and computer: no paths, names or settings of your own computer in the code.</li>
                <li>The service runs on both Node and Bun, and on every operating system Paperboard runs on, or the listing says which ones it needs.</li>
                <li>Every <PaperCode>fetch</PaperCode> has a timeout.</li>
                <li>The panel never runs code or commands it receives over the network. A program it downloads and runs, such as a game server, is one the person asked for, and the listing says so.</li>
                <li>Processes the service starts are found again after a restart, not started twice.</li>
            </PaperTextList>

            <PaperText preset="body" as="p">
                Next: <PaperLink href="/docs/guides/packaging/">package the panel</PaperLink>.
            </PaperText>
        </PaperFlex>
    );
}
