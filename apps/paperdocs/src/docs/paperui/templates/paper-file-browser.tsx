import {
    PaperCard,
    PaperCode,
    PaperFileBrowser,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";
import type {
    PaperFileContent,
    PaperFileEntry,
    PaperFileListing,
    PaperFileSaveResult,
} from "@mileniumhq/paperui";

// the demo's files live in memory; a panel reads and writes through PaperAPI
const files: Record<string, string> = {
    "readme.txt": "Hello.",
    "config/app.json": "{\n    \"enabled\": true\n}\n",
    "config/notes.md": "# Notes\n",
};

async function list(path: string): Promise<PaperFileListing> {
    const prefix = path === "" ? "" : `${path}/`;
    const seen = new Map<string, PaperFileEntry>();
    for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const entryPath = `${prefix}${name}`;
        seen.set(entryPath, { name, path: entryPath, kind: slash === -1 ? "file" : "folder" });
    }
    return { entries: [...seen.values()] };
}

async function read(path: string): Promise<PaperFileContent> {
    const text = files[path];
    if (text === undefined) throw new Error(`${path} does not exist`);
    return { kind: "text", text, version: String(text.length) };
}

async function write(path: string, text: string, version: string | undefined): Promise<PaperFileSaveResult> {
    if (files[path] === undefined) throw new Error(`${path} no longer exists`);
    if (version !== String(files[path].length)) throw new Error(`${path} changed since it was opened`);
    files[path] = text;
    return { version: String(text.length), message: "Saved" };
}

export default function PaperFileBrowserDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperFileBrowser</PaperText>
            <PaperText preset="body" as="p">
                PaperFileBrowser is a file explorer: a lazy folder tree beside a viewer that edits text files, previews images, and explains what it cannot show.
                Use it to let people read and change the files a panel manages, such as a game server's configuration.
                It owns no data: three functions you pass reach whatever holds the files.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass <PaperCode>list</PaperCode> and <PaperCode>read</PaperCode>, and <PaperCode>write</PaperCode> to make files editable.
                Paths are strings joined with <PaperCode>/</PaperCode> from the browser's root, and the root itself is the empty string.
                The browser fills its parent, so give the parent a height.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="back">
                <PaperFlex height="panel-height-large" fullWidth>
                    <PaperFileBrowser rootLabel="Demo" list={list} read={read} write={write} />
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { PaperFileBrowser } from "@mileniumhq/paperui";
import type {
    PaperFileContent,
    PaperFileEntry,
    PaperFileListing,
    PaperFileSaveResult,
} from "@mileniumhq/paperui";

const files: Record<string, string> = {
    "readme.txt": "Hello.",
    "config/app.json": "{\\n    \\"enabled\\": true\\n}\\n",
    "config/notes.md": "# Notes\\n",
};

async function list(path: string): Promise<PaperFileListing> {
    const prefix = path === "" ? "" : \`\${path}/\`;
    const seen = new Map<string, PaperFileEntry>();
    for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const entryPath = \`\${prefix}\${name}\`;
        seen.set(entryPath, { name, path: entryPath, kind: slash === -1 ? "file" : "folder" });
    }
    return { entries: [...seen.values()] };
}

async function read(path: string): Promise<PaperFileContent> {
    const text = files[path];
    if (text === undefined) throw new Error(\`\${path} does not exist\`);
    return { kind: "text", text, version: String(text.length) };
}

async function write(path: string, text: string, version: string | undefined): Promise<PaperFileSaveResult> {
    if (files[path] === undefined) throw new Error(\`\${path} no longer exists\`);
    if (version !== String(files[path].length)) throw new Error(\`\${path} changed since it was opened\`);
    files[path] = text;
    return { version: String(text.length), message: "Saved" };
}

export function Example() {
    return <PaperFileBrowser rootLabel="Demo" list={list} read={read} write={write} />;
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
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
                        <td><PaperCode>rootLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>Names the root folder in the tree and the breadcrumb.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; Promise&lt;PaperFileListing&gt;</PaperCode></td>
                        <td>Required</td>
                        <td>Lists one folder. Called for the root on mount, then for each folder when it is opened or the tree is refreshed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>read</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; Promise&lt;PaperFileContent&gt;</PaperCode></td>
                        <td>Required</td>
                        <td>Reads one file when it is opened or reloaded.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>(path: string, text: string, version: string | undefined) =&gt; Promise&lt;PaperFileSaveResult&gt;</PaperCode></td>
                        <td>No default (read-only)</td>
                        <td>Saves a text file. <PaperCode>version</PaperCode> is the token <PaperCode>read</PaperCode> returned for the content that was edited, so you can refuse to overwrite a file that changed.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reveal</PaperCode></td>
                        <td><PaperCode>PaperFileReveal | null</PaperCode></td>
                        <td>No default</td>
                        <td>Opens the tree to a path and selects it. A file is also opened. A new object reveals again, so pass a fresh object to repeat the same path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>highlight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Syntax highlighting in the editor.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fileMenu</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>The editor's file menu (the three-dot button): Save, Revert changes, Reload from disk, Word wrap, Line numbers, and Copy path.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sideWidth</PaperCode></td>
                        <td><PaperCode>number | string</PaperCode></td>
                        <td>The <PaperCode>split-side</PaperCode> size (320 px)</td>
                        <td>The tree pane's width, passed to <PaperLink href="/docs/paperui/papersplit/">PaperSplit</PaperLink>. A number is pixels, and a string is used as written, so pass a <PaperCode>var()</PaperCode> expression for a token.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default</td>
                        <td>Added to the root.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="types">Data types</PaperText>
            <PaperCode block language="ts">
{`interface PaperFileEntry {
    name: string;
    /** "/"-joined path from the browser's root ("" is the root itself) */
    path: string;
    kind: "file" | "folder";
    size?: number;
}

interface PaperFileListing {
    entries: PaperFileEntry[];
    /** shown under the folder's entries, such as "Showing the first 500 of 1,204" */
    note?: string;
}

type PaperFileContent =
    | {
          kind: "text";
          text: string;
          /** a token handed back to \`write\`, so a save can refuse a file that changed */
          version?: string;
          /** a Prism language id; defaults to one picked from the extension */
          language?: string;
          /** set to say why this file opens read-only */
          readOnly?: string;
      }
    | { kind: "image"; src: string; alt?: string }
    | { kind: "unavailable"; reason: string };

interface PaperFileSaveResult {
    version?: string;
    /** shown after saving, such as when the change takes effect; "Saved" when absent */
    message?: string;
}

interface PaperFileReveal {
    path: string;
    kind: "file" | "folder";
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="errors">Errors</PaperText>
            <PaperText preset="body" as="p">
                The browser never hides a failure. Throw an <PaperCode>Error</PaperCode> from any of the three functions and its message is shown where the result would have been.
            </PaperText>
            <PaperTextList>
                <li><PaperCode>list</PaperCode> fails: the folder's row shows the message with a Retry button.</li>
                <li><PaperCode>read</PaperCode> fails: the viewer shows "Couldn't open" with the file name and the message.</li>
                <li><PaperCode>write</PaperCode> fails: a danger notice with the message and a Reload from disk button. The edit stays in the editor.</li>
                <li><PaperCode>write</PaperCode> succeeds: a success notice with <PaperCode>message</PaperCode>, or "Saved". Return the new <PaperCode>version</PaperCode> so the next save compares against it.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="viewer">The viewer</PaperText>
            <PaperTextList>
                <li>A <PaperCode>text</PaperCode> file opens in <PaperLink href="/docs/paperui/papereditor/">PaperEditor</PaperLink>. Ctrl+S or Cmd+S saves. A status bar shows the cursor position, a read-only reason if there is one, and the language.</li>
                <li>A text file is read-only when <PaperCode>readOnly</PaperCode> is set on its content, with that text as the reason, or when the browser has no <PaperCode>write</PaperCode> ("This browser is read-only").</li>
                <li>The language comes from the content's <PaperCode>language</PaperCode>, else from the file extension. Extensions it has no grammar for are shown by name without highlighting, and anything unknown is "Plain text".</li>
                <li>An <PaperCode>image</PaperCode> file is previewed from <PaperCode>src</PaperCode>. An <PaperCode>unavailable</PaperCode> file shows "This file can't be shown here" and the reason, for binary or oversized files.</li>
                <li>Opening another file, closing the open one, or reloading while edits are unsaved asks to save, discard, or cancel first. A dot on the file's row and in the breadcrumb marks unsaved edits.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="tree">The tree</PaperText>
            <PaperTextList>
                <li>Folders list on first open and stay loaded. The refresh button in the tree header lists every open folder again.</li>
                <li>It is a tree with roving focus. Arrow keys move, Right opens a folder or steps into it, Left closes a folder or moves to its parent, Home and End jump to the ends, and Enter or Space opens the row.</li>
                <li>Return <PaperCode>note</PaperCode> from <PaperCode>list</PaperCode> to say a listing is cut short. It shows under the entries.</li>
                <li>Page long folders yourself and say so in <PaperCode>note</PaperCode>: the browser draws every entry it is given.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="narrow">Narrow panels</PaperText>
            <PaperText preset="body" as="p">
                The tree and viewer sit in a <PaperLink href="/docs/paperui/papersplit/">PaperSplit</PaperLink>. In a narrow panel the tree fills the space and the open file shows as a modal over it.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="security">Paths and security</PaperText>
            <PaperText preset="body" as="p">
                The browser passes whatever paths it holds to your functions and checks nothing.
                Treat every path as untrusted input in <PaperCode>list</PaperCode>, <PaperCode>read</PaperCode>, and <PaperCode>write</PaperCode>: resolve it against the folder you serve and refuse anything that leaves it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="helpers">Helpers</PaperText>
            <PaperText preset="body" as="p">
                The module also exports the pure functions it uses, for panels that draw file names themselves.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Export</th>
                        <th>Signature</th>
                        <th>Returns</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>paperFileIcon</PaperCode></td>
                        <td><PaperCode>(name: string, kind: "file" | "folder", expanded?: boolean) =&gt; string</PaperCode></td>
                        <td>A Material Symbols name for the file or folder.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paperFileLanguage</PaperCode></td>
                        <td><PaperCode>(name: string) =&gt; PaperFileLanguage</PaperCode></td>
                        <td><PaperCode>{"{ id?: string; label: string }"}</PaperCode>: a Prism language id (absent for plain text) and a display label.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ancestorPaths</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; string[]</PaperCode></td>
                        <td><PaperCode>"a/b/c"</PaperCode> gives <PaperCode>["a", "a/b", "a/b/c"]</PaperCode>, and <PaperCode>""</PaperCode> gives <PaperCode>[]</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parentPath</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; string</PaperCode></td>
                        <td>The path up to the last slash, or <PaperCode>""</PaperCode>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>baseName</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; string</PaperCode></td>
                        <td>The part after the last slash.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>PAPER_FILE_BROWSER_ICONS</PaperCode></td>
                        <td><PaperCode>Record&lt;PaperFileBrowserIcon, string&gt;</PaperCode></td>
                        <td>Every icon name the browser draws, keyed by role (<PaperCode>folder</PaperCode>, <PaperCode>save</PaperCode>, <PaperCode>refresh</PaperCode>, and the rest).</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="gameserver">A panel's Files tab</PaperText>
            <PaperText preset="body" as="p">
                The game server panel shows the browser in its Files tab, hosted as a <PaperCode>fill</PaperCode> interface item, and opens it at an add-on's settings through <PaperCode>reveal</PaperCode>.
                Its three functions are the panel's own wrappers that call the panel's service, which validates every path.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperFileBrowser, PaperFlex } from "@mileniumhq/paperui";
import type { PaperFileReveal } from "@mileniumhq/paperui";
import { listServerFiles, readServerFile, writeServerFile } from "../lib/files";

export function Files(props: { reveal: PaperFileReveal | null }) {
    return (
        <PaperFlex direction="row" flex minHeight={0}>
            <PaperFileBrowser
                rootLabel="Server"
                list={listServerFiles}
                read={readServerFile}
                write={writeServerFile}
                reveal={props.reveal}
            />
        </PaperFlex>
    );
}`}
            </PaperCode>
        </PaperFlex>
    );
}
