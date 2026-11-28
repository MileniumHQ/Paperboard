import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

const USAGE = `import { isRecord, sharedApi, type SharedDocument } from "@mileniumhq/paperapi";
import { showError, showToast } from "@mileniumhq/paperui";

const PANEL_ID = "dev.example.recipes";

interface Recipe {
    name: string;
    steps: string[];
}

// checks a saved value and returns it, or throws why it isn't one
function readRecipe(value: unknown): Recipe {
    if (!isRecord(value) || typeof value.name !== "string" || !Array.isArray(value.steps) || !value.steps.every((s): s is string => typeof s === "string")) {
        throw new Error("This recipe was saved by a newer version of Recipes");
    }
    return { name: value.name, steps: value.steps };
}

const recipes = sharedApi.panel(PANEL_ID, readRecipe);

// every recipe now, then each change: from this computer or another one
const stop = recipes.watch(
    ({ documents, changes }) => {
        setRecipes(documents);
        for (const change of changes) {
            const doc = change.document;
            if (doc && !doc.author.self && change.id === editing()?.id) {
                showToast({ variant: "warning", title: \`Changed on \${doc.author.name ?? "another computer"}\`, message: "Your edits are still here; saving keeps yours." });
            }
        }
    },
    (err) => showError("Couldn't read the recipes", err),
    { prefix: "recipes/" },
);

async function save(open: SharedDocument<Recipe>, edited: Recipe): Promise<void> {
    const { overwrote } = await recipes.set(open.id, edited, { basedOn: open.version });
    if (overwrote && !overwrote.author.self) {
        // the other computer's version is kept: versions() lists it, restore() brings it back
        showToast({ variant: "warning", title: \`Saved over a change made on \${overwrote.author.name ?? "another computer"}\` });
    }
}`;

export default function SharedApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">sharedApi</PaperText>
            <PaperText preset="body" as="p">
                sharedApi keeps a panel's settings and documents on every computer of the network: change a document on one computer, and the others have it as soon as they connect.
                It works on a panel page, in a widget and in a service.
                Each computer holds its own copy, so a document can be read and written while computers are apart.
                Settings that belong to one computer stay in <PaperLink href="/docs/paperapi/config/">configApi</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="which">sharedApi or configApi</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Use</th>
                        <th>For</th>
                        <th>Such as</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>sharedApi</PaperCode></td>
                        <td>What the person made and expects to find on every computer.</td>
                        <td>A bot's name and commands, a project's flows, saved commands, a list of favorites.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>configApi</PaperCode></td>
                        <td>What only makes sense on this computer.</td>
                        <td>Folder paths, which servers run here, open tabs, when a schedule last ran here, state a running program left.</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperapi/secrets/">secretsApi</PaperLink></td>
                        <td>Tokens, passwords and keys.</td>
                        <td>A bot's token, an API key.</td>
                    </tr>
                    <tr>
                        <td><PaperLink href="/docs/paperapi/file/">fileApi</PaperLink></td>
                        <td>Files and anything that grows.</td>
                        <td>Worlds, logs, uploads, media.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Every computer of the network can read a shared document. Never put a secret in one: secrets go in secretsApi, which stays on the computer that saved them.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">{USAGE}</PaperCode>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`/** a panel's documents; read checks each saved value and returns it, or throws why it isn't one */
sharedApi.panel<T>(panelId: string, read: (value: unknown) => T, scope?: string): SharedDocuments<T>;
/** Paperboard's own shared settings: the host's credential only */
sharedApi.shell<T>(read: (value: unknown) => T, scope?: string): SharedDocuments<T>;

interface SharedDocuments<T> {
    get(id: string): Promise<SharedDocument<T> | null>;
    list(options?: { prefix?: string }): Promise<SharedDocument<T>[]>;
    set(id: string, value: T, options?: { basedOn?: string | null }): Promise<SharedWrite<T>>;
    delete(id: string, options?: { basedOn?: string | null }): Promise<SharedDelete<T>>;
    /** the kept versions, the current one first */
    versions(id: string): Promise<SharedVersion<T>[]>;
    /** makes an earlier version current again, as a new write; null when it was a delete */
    restore(id: string, version: string): Promise<SharedDocument<T> | null>;
    /** every document now and on each change; returns the unsubscribe */
    watch(listener: (snapshot: SharedSnapshot<T>) => void, onError: (err: unknown) => void, options?: { prefix?: string }): () => void;
}

type SharedDocument<T> = {
    id: string;
    /** this version: what basedOn and restore() take */
    version: string;
    /** the computer that wrote it */
    author: { computer: string; name?: string; self: boolean };
    /** when it was written, in ms since the epoch, by that computer's clock */
    writtenAt: number;
} & ({ state: "value"; value: T } | { state: "unreadable"; error: string });

/** a kept version may also be a delete */
type SharedVersion<T> = SharedDocument<T> | (Omit<SharedDocument<T>, "state"> & { state: "deleted" });

interface SharedWrite<T> {
    document: SharedDocument<T>;
    /** what the write replaced when that wasn't basedOn; null otherwise */
    overwrote: SharedVersion<T> | null;
}
interface SharedDelete<T> {
    /** false when there was no document */
    deleted: boolean;
    overwrote: SharedVersion<T> | null;
}
interface SharedSnapshot<T> {
    documents: SharedDocument<T>[];
    /** what changed since the last call; the first call lists every document */
    changes: { id: string; document: SharedDocument<T> | null }[];
}`}
            </PaperCode>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>What it does</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>panelId</PaperCode></td><td>Your panel's id. A panel reaches only its own documents: naming another panel is refused.</td></tr>
                    <tr><td><PaperCode>read</PaperCode></td><td>Checks a saved value, as <PaperCode>readRecipe</PaperCode> does above. A value it throws on is listed as <PaperCode>unreadable</PaperCode>, with its message as the <PaperCode>error</PaperCode>, so one document saved by a newer version doesn't hide the rest.</td></tr>
                    <tr><td><PaperCode>id</PaperCode></td><td>Letters, digits, <PaperCode>.</PaperCode>, <PaperCode>_</PaperCode> and <PaperCode>-</PaperCode>, in parts split by <PaperCode>/</PaperCode> that each start with a letter or digit, such as <PaperCode>recipes/r-4f2a</PaperCode>. At most 200 characters.</td></tr>
                    <tr><td><PaperCode>prefix</PaperCode></td><td>Only the documents whose id starts with it.</td></tr>
                    <tr><td><PaperCode>basedOn</PaperCode></td><td>The <PaperCode>version</PaperCode> the change was made on, or <PaperCode>null</PaperCode> for a document that didn't exist yet. Leave it out to not be told.</td></tr>
                    <tr><td><PaperCode>scope</PaperCode></td><td>The computer to ask. Every computer holds the same documents, so the default, the computer the panel was opened on, is the one to use. See <PaperLink href="/docs/paperapi/connection/">Connection and identity</PaperLink>.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="conflicts">Changes on two computers</PaperText>
            <PaperTextList>
                <li>A <PaperCode>set</PaperCode> replaces the whole document and always saves. When two computers change the same document apart, the later change wins on every computer once they connect.</li>
                <li>The version that lost is kept: <PaperCode>versions</PaperCode> lists one per computer that wrote the document, and <PaperCode>restore</PaperCode> makes one current again. A computer's own earlier version is replaced by its next one, not kept.</li>
                <li>Pass <PaperCode>basedOn</PaperCode> and the answer's <PaperCode>overwrote</PaperCode> names the version you saved over when it wasn't the one you started from: another computer's change, or another window's. Tell the person, as the sample does. The write is not refused: a computer can only check what it has heard of, so two computers apart would both pass any check.</li>
                <li>A change that arrives later from another computer reaches <PaperCode>watch</PaperCode> like any other. <PaperCode>author.self</PaperCode> is false and <PaperCode>author.name</PaperCode> is that computer's name, so the page can say "Changed on Laptop".</li>
                <li>Controls save the usual way: flip at once, save in order, and go back with an error only when the save fails. A change from another computer that wins later moves the control again through <PaperCode>watch</PaperCode>.</li>
                <li>Keep documents small and separate: a project per document rather than one document of every project, so changes to different things never meet.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="limits">Limits</PaperText>
            <PaperText preset="body" as="p">
                Shared documents are for settings and documents, not bulk data: every computer keeps all of them in memory, and a version for each computer that wrote one.
                Files, logs and anything that grows go in the panel's <PaperLink href="/docs/paperapi/file/">files</PaperLink>.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Limit</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>One document</td><td>256 KiB of JSON, counted in UTF-8 bytes.</td></tr>
                    <tr><td>Documents a panel holds</td><td>1,000.</td></tr>
                    <tr><td>Ids a panel has used</td><td>5,000, deleted ones included: every computer remembers a delete. Reuse an id when a thing comes back, and don't name each save afresh.</td></tr>
                    <tr><td>All a panel's documents</td><td>8 MiB, as stored.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Paperboard's own settings (<PaperCode>sharedApi.shell</PaperCode>) have the same limits, apart from every panel's.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li><PaperCode>get</PaperCode> resolves with <PaperCode>null</PaperCode> when there is no document. A document this computer holds but can't open yet, because it was written under a network key this computer hasn't been given, is <PaperCode>unreadable</PaperCode>, never missing. Show it as such: it becomes readable once the key arrives, and <PaperCode>watch</PaperCode> hears it then.</li>
                <li>A document's value is encrypted for the network's computers. Its id, and which computer wrote it when, are not: a relay that carries documents between computers can read them. Keep names and anything personal in the value.</li>
                <li><PaperCode>watch</PaperCode> reads every document once, then only the ones a change names, one read at a time, in order. It reads everything again after a reconnect, so nothing said while it was away is missed. A read that fails goes to <PaperCode>onError</PaperCode> and is tried again on the next change or reconnect.</li>
                <li>Uninstalling a panel from one computer keeps its shared documents: the other computers still use them.</li>
                <li>A backup holds a panel's files, not its shared documents. Every computer of the network holds them already.</li>
            </PaperTextList>

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
                    <tr><td><PaperCode>Invalid shared document id "&lt;id&gt;": ...</PaperCode></td><td>No code</td><td>An id outside the rules above. Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>The shared document "&lt;id&gt;" is &lt;n&gt; bytes; a shared document holds at most 262144. ...</PaperCode></td><td>No code</td><td>A value over 256 KiB. Thrown before anything is sent.</td></tr>
                    <tr><td><PaperCode>A shared document's value can't be undefined: delete() removes one</PaperCode></td><td>No code</td><td><PaperCode>set</PaperCode> was given no value.</td></tr>
                    <tr><td><PaperCode>&lt;panel&gt;'s shared documents hold 1000 documents, the most there can be; delete one first.</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A new document past 1,000.</td></tr>
                    <tr><td><PaperCode>&lt;panel&gt;'s shared documents have used 5000 document ids, ...</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>A new id past 5,000, deleted ones included.</td></tr>
                    <tr><td><PaperCode>&lt;panel&gt;'s shared documents would hold &lt;n&gt; bytes with this write; ...</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>All the panel's documents would pass 8 MiB.</td></tr>
                    <tr><td><PaperCode>The shared document "&lt;id&gt;" has no version &lt;version&gt;</PaperCode></td><td><PaperCode>NOT_FOUND</PaperCode></td><td><PaperCode>restore</PaperCode> was given a version <PaperCode>versions</PaperCode> doesn't list.</td></tr>
                    <tr><td><PaperCode>Version &lt;version&gt; of "&lt;id&gt;" is already the current one</PaperCode></td><td><PaperCode>INVALID_PARAMS</PaperCode></td><td>Nothing to restore.</td></tr>
                    <tr><td><PaperCode>Shared documents are the panel's own: ...</PaperCode></td><td><PaperCode>FORBIDDEN</PaperCode></td><td>A panel's credential named another panel, or asked for Paperboard's own settings.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
