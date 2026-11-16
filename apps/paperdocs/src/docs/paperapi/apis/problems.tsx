import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function ProblemsApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">problemsApi</PaperText>
            <PaperText preset="body" as="p">
                problemsApi tells the person something failed when no button was waiting for it: a poll, a timer, a reconnect, a Blocks event, cleanup after an action that already answered.
                Paperboard shows a panel's problems on its row in the sidebar, counted, with a list the person opens and dismisses from.
                It works in a service, on a panel page and in a widget, and shows the same for every panel.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { errorMessage, problemsApi } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.weather";

async function refreshCity(city: string): Promise<void> {
    try {
        await refresh(city);
        // fixed: the problem goes from the sidebar
        problemsApi.clear(PANEL_ID, \`refresh:\${city}\`);
    } catch (err) {
        // the same key again replaces it, so a check that fails every
        // minute is one problem, not sixty
        problemsApi.report(PANEL_ID, { key: \`refresh:\${city}\`, title: \`\${city} wasn't refreshed\`, message: errorMessage(err) });
    }
}

function removeCity(city: string): void {
    // every problem about the city goes with it
    problemsApi.clear(PANEL_ID, { prefix: \`refresh:\${city}\` });
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`problemsApi.report(panelId: string, problem: { title: string; message: string; key?: string }, scope?: string): void;
/** with { prefix }, every problem whose key starts with it; without a key, all the panel's problems */
problemsApi.clear(panelId: string, key?: string | { prefix: string }, scope?: string): void;
/** the one reported longest ago first */
problemsApi.list(panelId: string, scope?: string): Promise<PanelProblem[]>;
/** the whole list now and on each change; returns the unsubscribe */
problemsApi.watch(panelId: string, listener: (problems: PanelProblem[]) => void, onError: (err: unknown) => void, scope?: string): () => void;
/** Paperboard's own, for its sidebar: every panel's problems by panel id. A panel's credential is refused. */
problemsApi.watchEvery(listener: (byPanel: Record<string, PanelProblem[]>) => void, onError: (err: unknown) => void, scope?: string): () => void;

interface PanelProblem {
    key: string;
    title: string;
    message: string;
    /** when it was last reported, in ms since the epoch */
    at: number;
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Value</th>
                        <th>Rule</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>title</PaperCode></td><td>What failed, as a short sentence, such as <PaperCode>Oslo wasn't refreshed</PaperCode>. At most 200 characters; a longer one is cut to fit, ending in <PaperCode>…</PaperCode>.</td></tr>
                    <tr><td><PaperCode>message</PaperCode></td><td>Why, in the failure's own words: <PaperCode>errorMessage(err)</PaperCode>. At most 2000 characters; a longer one is cut to fit.</td></tr>
                    <tr><td><PaperCode>key</PaperCode></td><td>What the problem is about. A report with a key the panel already has replaces it and counts as the newest. Without one, every report is a new problem. 1 to 200 characters.</td></tr>
                    <tr><td>Count</td><td>A panel keeps its 20 newest problems; one more drops the one reported longest ago.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="delivery">Delivery</PaperText>
            <PaperTextList>
                <li><PaperCode>report</PaperCode> and <PaperCode>clear</PaperCode> return at once and arrive in the order they were made. One that can't reach the Paperboard Server is sent again, half a second later and doubling up to 30 seconds, until it arrives; each try that fails is logged as <PaperCode>[paperapi] A problem could not reach the Paperboard Server</PaperCode>.</li>
                <li>While they wait, a newer report or clear of the same key takes the place of the older one, a clear by prefix takes the place of everything waiting about a key under it, and a clear of all the panel's problems takes the place of all of them.</li>
                <li>Key a panel's problems by what they are about, such as <PaperCode>{"${bot.id}:login"}</PaperCode>, so deleting that thing clears them all with <PaperCode>{"clear(panelId, { prefix: `${bot.id}:` })"}</PaperCode>.</li>
                <li>Every change is pushed: the sidebar and each <PaperCode>watch</PaperCode> hear it as it happens, and read the whole list again only after a reconnect. A new problem shows as the panel's badge in the sidebar, never as a toast.</li>
                <li>Problems live in the Paperboard Server's memory. They outlive a restart of the service, but not of the server, whose services start again and report what is still wrong. Uninstalling the panel removes them.</li>
                <li>The person dismissing a problem removes it for everyone. Report it again if it happens again.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="when">When to use it</PaperText>
            <PaperText preset="body" as="p">
                A failure the person caused with a button goes in a toast, and a failure the page shows in place, such as a city's tile, stays in the state.
                problemsApi is for the rest: a failure that would otherwise only reach the log.
                <PaperCode>definePanelService</PaperCode> reports its own the same way: an <PaperCode>afterBackup</PaperCode>, <PaperCode>afterRestore</PaperCode> or <PaperCode>afterUpdate</PaperCode> that throws, and an <PaperCode>emit</PaperCode> that doesn't reach the page.
                See <PaperLink href="/docs/developers/errors/#in-the-background">Show every failure</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Error</th>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>A problem needs a &lt;title|message|key&gt;: some text</PaperCode></td><td>No code</td><td>A missing or blank value. Thrown by <PaperCode>report</PaperCode> or <PaperCode>clear</PaperCode> before anything is sent.</td></tr>
                    <tr><td><PaperCode>A problem's key is at most &lt;n&gt; characters, not &lt;length&gt;</PaperCode></td><td>No code</td><td>A key longer than 200 characters. Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>Invalid panel id: ...</PaperCode></td><td>No code</td><td>A <PaperCode>panelId</PaperCode> that isn't one. Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>Cross-panel access refused: credential is scoped to "&lt;panel&gt;"</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>Another panel's id. <PaperCode>list</PaperCode> rejects with it; a <PaperCode>report</PaperCode> or <PaperCode>clear</PaperCode> refused this way is logged as <PaperCode>[paperapi] The Paperboard Server refused a problem</PaperCode> and dropped.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
