import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";

export default function PaperFileBrowserDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperFileBrowser</PaperText>
            <PaperText preset="body">
                PaperFileBrowser is a small file explorer: a folder tree beside a viewer that edits text files, previews images, and explains what it cannot show.
                Reach for PaperFileBrowser when a panel lets people look through and edit the files of a server, a project, or a workspace.
                It owns no data. The list, read and write props reach whatever owns the files, and that owner validates every path.
            </PaperText>
            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Pass a root label and functions that list a folder and read a file. Add write to let text files be saved.
                Paths are joined with forward slashes and start at the browser's root. The root itself is the empty string.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperFileBrowser, type PaperFileContent, type PaperFileListing } from "@mileniumhq/paperui";

async function list(path: string): Promise<PaperFileListing> {
    return { entries: await service.listFolder(path) };
}

async function read(path: string): Promise<PaperFileContent> {
    const file = await service.readFile(path);
    return { kind: "text", text: file.text, version: file.version };
}

async function write(path: string, text: string, version: string | undefined) {
    return { version: await service.writeFile(path, text, version) };
}

export function Files() {
    return <PaperFileBrowser rootLabel="Server" list={list} read={read} write={write} />;
}`}
            </PaperCode>
            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>rootLabel</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>Names the root folder in the tree and the breadcrumb.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; Promise&lt;PaperFileListing&gt;</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>Lists one folder. Called when a folder is first opened.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>read</PaperCode></td>
                        <td><PaperCode>(path: string) =&gt; Promise&lt;PaperFileContent&gt;</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>Reads one file when it is opened.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>write</PaperCode></td>
                        <td><PaperCode>(path, text, version) =&gt; Promise&lt;PaperFileSaveResult&gt;</PaperCode></td>
                        <td>no default</td>
                        <td>Saves a text file. Without it the browser is read-only.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>reveal</PaperCode></td>
                        <td><PaperCode>PaperFileReveal | null</PaperCode></td>
                        <td>no default</td>
                        <td>Opens the tree to a path, and opens the file if it is one. Pass a new object to reveal the same path again.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>highlight</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Syntax colors in the editor.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>fileMenu</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>true</PaperCode></td>
                        <td>Shows the editor's file menu.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sideWidth</PaperCode></td>
                        <td><PaperCode>number | string</PaperCode></td>
                        <td>no default</td>
                        <td>Width of the folder tree.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>class</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>no default</td>
                        <td>A class for the root element.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="subheader" id="data-shapes">Data shapes</PaperText>
            <PaperText preset="body">
                list resolves to a PaperFileListing. Its note is shown under the folder's entries, for a listing that was cut short.
            </PaperText>
            <PaperCode block language="tsx">
{`interface PaperFileEntry {
    name: string;
    path: string;
    kind: "file" | "folder";
    size?: number;
}

interface PaperFileListing {
    entries: PaperFileEntry[];
    note?: string;
}`}
            </PaperCode>
            <PaperText preset="body">
                read resolves to one of three kinds of PaperFileContent. Text opens in the editor, an image is previewed, and unavailable shows the reason in place of the file.
                A text file's version is an opaque token handed back to write, so a save can refuse a file that changed since it was read. Its readOnly field says why a file cannot be edited.
            </PaperText>
            <PaperCode block language="tsx">
{`type PaperFileContent =
    | { kind: "text"; text: string; version?: string; language?: string; readOnly?: string }
    | { kind: "image"; src: string; alt?: string }
    | { kind: "unavailable"; reason: string };

interface PaperFileSaveResult {
    version?: string;
    message?: string;
}

interface PaperFileReveal {
    path: string;
    kind: "file" | "folder";
}`}
            </PaperCode>
            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                Folders load when they are first opened. Each shows its own loading, error and empty state, so one folder that cannot be read does not hide the rest of the tree.
                Closing or switching away from a file with unsaved edits asks before discarding them.
                The editor's language comes from the content's language field, or from the file extension when that is absent.
                A response to list or read that arrives after a newer request for the same place is discarded.
            </PaperText>
            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                The helpers the browser uses for paths and file types are exported for panels that show files elsewhere.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Function</th>
                        <th>Signature</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>paperFileIcon</PaperCode></td>
                        <td><PaperCode>paperFileIcon(name, kind, expanded?): string</PaperCode></td>
                        <td>The icon name for a file or folder.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>paperFileLanguage</PaperCode></td>
                        <td><PaperCode>paperFileLanguage(name): PaperFileLanguage</PaperCode></td>
                        <td>The language of a file name: an id for the editor when one exists, and a label such as Plain text.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ancestorPaths</PaperCode></td>
                        <td><PaperCode>ancestorPaths(path): string[]</PaperCode></td>
                        <td>Every folder on the way to a path: a/b/c gives a, a/b and a/b/c.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>parentPath</PaperCode></td>
                        <td><PaperCode>parentPath(path): string</PaperCode></td>
                        <td>The folder a path is in.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>baseName</PaperCode></td>
                        <td><PaperCode>baseName(path): string</PaperCode></td>
                        <td>The last part of a path.</td>
                    </tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
