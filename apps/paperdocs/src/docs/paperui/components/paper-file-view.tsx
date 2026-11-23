import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFileView,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
    type PaperFileViewEntry,
    type PaperFileViewMode,
    type PaperFileViewSort,
} from "@mileniumhq/paperui";

// the demo's files live in the page; a panel lists its own from its service
const DAY = 86_400_000;
const now = Date.now();
const demoFiles: Record<string, PaperFileViewEntry[]> = {
    "": [
        { name: "Photos", path: "Photos", kind: "folder", count: 2, modified: now - DAY },
        { name: "Documents", path: "Documents", kind: "folder", count: 1, modified: now - 3 * DAY },
        { name: "Budget 2026.csv", path: "Budget 2026.csv", kind: "file", size: 48_000, modified: now },
        { name: "Lease agreement.pdf", path: "Lease agreement.pdf", kind: "file", size: 2_400_000, modified: now - 9 * DAY },
        { name: "Camping checklist.md", path: "Camping checklist.md", kind: "file", size: 3_100, modified: now - 40 * DAY },
        { name: "Minecraft world.zip", path: "Minecraft world.zip", kind: "file", size: 1_200_000_000, modified: now - 120 * DAY },
    ],
    Photos: [
        { name: "beach.jpg", path: "Photos/beach.jpg", kind: "file", size: 3_100_000, modified: now - DAY },
        { name: "dunes.jpg", path: "Photos/dunes.jpg", kind: "file", size: 2_800_000, modified: now - DAY },
    ],
    Documents: [{ name: "Novel draft.md", path: "Documents/Novel draft.md", kind: "file", size: 186_000, modified: now - 3 * DAY }],
};

function Demo() {
    const [folder, setFolder] = createSignal("");
    const [mode, setMode] = createSignal<PaperFileViewMode>("icons");
    const [selection, setSelection] = createSignal<string[]>([]);
    const [sort, setSort] = createSignal<PaperFileViewSort>({ key: "name", dir: 1 });
    return (
        <PaperFlex direction="column" fullWidth>
            <PaperFlex direction="row" align="center" gap="half" padding="half">
                <PaperButton size="small" variant="text" disabled={folder() === ""} onClick={() => setFolder("")}>
                    Top
                </PaperButton>
                <PaperFlex flex />
                <PaperButton size="small" variant={mode() === "icons" ? undefined : "text"} onClick={() => setMode("icons")}>
                    Icons
                </PaperButton>
                <PaperButton size="small" variant={mode() === "list" ? undefined : "text"} onClick={() => setMode("list")}>
                    List
                </PaperButton>
            </PaperFlex>
            <PaperFlex direction="column" height="panel-height-medium" minHeight={0}>
                <PaperFileView
                    aria-label="Example files"
                    folder={folder()}
                    list={async (f) => demoFiles[f] ?? []}
                    mode={mode()}
                    selection={selection()}
                    onSelectionChange={setSelection}
                    onOpen={(entry) => entry.kind === "folder" && setFolder(entry.path)}
                    sort={sort()}
                    onSortChange={setSort}
                />
            </PaperFlex>
        </PaperFlex>
    );
}

export default function PaperFileViewDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperFileView</PaperText>
            <PaperText preset="body" as="p">
                PaperFileView shows a folder's files and folders the way a desktop does: as icons, or as a list with columns. It owns choosing entries, the keys that move through them, renaming in place, dragging entries onto folders and dropping files from the computer. The host owns where the files live and every command beyond those, such as opening, downloading and deleting.
            </PaperText>
            <PaperText preset="body" as="p">
                For a file tree with an editor beside it, use <PaperLink href="/docs/paperui/paperfilebrowser/">PaperFileBrowser</PaperLink>. To show one file, use <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Give it the <PaperCode>folder</PaperCode> to show, a <PaperCode>list</PaperCode> function that lists any folder, and the <PaperCode>selection</PaperCode> with its setter. It fills its box edge to edge with no border or rounding, so put it in a column that gives it the height left over. Double-click a folder to open it.
            </PaperText>
            <PaperCard data-docs-demo surface="front" padding="none">
                <Demo />
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperFileView, type PaperFileViewEntry } from "@mileniumhq/paperui";

export function Files(props: { list: (folder: string) => Promise<PaperFileViewEntry[]>; preview: (entry: PaperFileViewEntry) => void }) {
    const [folder, setFolder] = createSignal("");
    const [selection, setSelection] = createSignal<string[]>([]);
    return (
        <PaperFileView
            aria-label="Files"
            folder={folder()}
            list={props.list}
            selection={selection()}
            onSelectionChange={setSelection}
            onOpen={(entry) => (entry.kind === "folder" ? setFolder(entry.path) : props.preview(entry))}
        />
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="entries">Entries</PaperText>
            <PaperText preset="body" as="p">
                The <PaperCode>list</PaperCode> function resolves with <PaperCode>PaperFileViewEntry</PaperCode> objects. Paths are joined with <PaperCode>/</PaperCode> from the host's top folder, which is the path <PaperCode>""</PaperCode>.
            </PaperText>
            <PaperCode block language="ts">
{`interface PaperFileViewEntry {
    name: string;
    /** "/"-joined from the host's root; "" is the root itself */
    path: string;
    kind: "file" | "folder";
    /** a file's size in bytes */
    size?: number;
    /** when it last changed, in ms since the epoch */
    modified?: number;
    /** a folder's item count, shown in place of a size */
    count?: number;
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
                        <td><PaperCode>folder</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>The folder shown. When it changes, the view lists the new folder and keeps the old one on screen until that listing arrives.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>list</PaperCode></td>
                        <td><PaperCode>(folder: string) =&gt; Promise&lt;PaperFileViewEntry[]&gt;</PaperCode></td>
                        <td>Required</td>
                        <td>Lists a folder. A rejection shows a <PaperLink href="/docs/paperui/papererror/">PaperError</PaperLink> in the view with Try again. A newer listing of a folder wins over an older one.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>mode</PaperCode></td>
                        <td><PaperCode>"icons" | "list"</PaperCode></td>
                        <td><PaperCode>"icons"</PaperCode></td>
                        <td>Icons in a grid, or a list with Modified, Size and Kind columns whose folders open in place with their arrow.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>selection</PaperCode>, <PaperCode>onSelectionChange</PaperCode></td>
                        <td><PaperCode>readonly string[]</PaperCode>, <PaperCode>(paths: string[]) =&gt; void</PaperCode></td>
                        <td>Required</td>
                        <td>The chosen paths, in the order they were chosen. The view calls the setter; the host owns the value.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onOpen</PaperCode></td>
                        <td><PaperCode>(entry) =&gt; void</PaperCode></td>
                        <td>Required</td>
                        <td>Enter, a double click, a tap on a touch screen, or a drag held over a folder.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onQuickLook</PaperCode></td>
                        <td><PaperCode>(entry) =&gt; void</PaperCode></td>
                        <td>None</td>
                        <td>Space, with the entry that leads the choice.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onRename</PaperCode></td>
                        <td><PaperCode>(entry, name: string) =&gt; void | Promise&lt;void&gt;</PaperCode></td>
                        <td>None</td>
                        <td>Turns on F2 and a slow second click on a chosen name. The name is trimmed; an empty or unchanged name is not passed on.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onDelete</PaperCode></td>
                        <td><PaperCode>(entries) =&gt; void</PaperCode></td>
                        <td>None</td>
                        <td>Delete, or ⌘⌫ on a Mac, with the chosen entries. The view deletes nothing itself: ask first, then delete.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onDrop</PaperCode></td>
                        <td><PaperCode>(drop: PaperFileViewDrop) =&gt; void</PaperCode></td>
                        <td>None</td>
                        <td>Turns on dragging. <PaperCode>{`{ kind: "entries", paths, folder }`}</PaperCode> is entries dragged onto a folder; <PaperCode>{`{ kind: "files", files, folder }`}</PaperCode> is files from the computer dropped on a folder, or on the view's space for the folder shown.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>onContextMenu</PaperCode></td>
                        <td><PaperCode>(event: MouseEvent, entry | null) =&gt; void</PaperCode></td>
                        <td>None</td>
                        <td>A right click. On an entry that isn't chosen, it is chosen first; on empty space the entry is null and the choice is cleared. Open a <PaperLink href="/docs/paperui/papercontextmenu/">PaperContextMenu</PaperLink> from it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>thumbnail</PaperCode></td>
                        <td><PaperCode>(entry, {`{ size, edge, signal }`}) =&gt; Promise&lt;Blob | null&gt;</PaperCode></td>
                        <td>None</td>
                        <td>A picture of a file drawn in place of its symbol. See <PaperLink href="#thumbnails">Thumbnails</PaperLink>.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>sort</PaperCode>, <PaperCode>onSortChange</PaperCode></td>
                        <td><PaperCode>{`{ key: "name" | "modified" | "size" | "kind"; dir: 1 | -1 }`}</PaperCode></td>
                        <td>By name, ascending</td>
                        <td>The order in both modes; folders always come first. The list's column heads change it through <PaperCode>onSortChange</PaperCode>, and are not pressable without it.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>iconSize</PaperCode></td>
                        <td><PaperCode>number</PaperCode></td>
                        <td><PaperCode>72</PaperCode></td>
                        <td>The icon's edge in px. Narrower than 560px, the view uses at most 56.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>empty</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>"This folder is empty"</td>
                        <td>What an empty folder shows, such as a <PaperLink href="/docs/paperui/paperemptystate/">PaperEmptyState</PaperLink> with an Upload button.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>aria-label</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>Required</td>
                        <td>Names the view: a listbox in icons, a treegrid in a list.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>ref</PaperCode></td>
                        <td><PaperCode>(view: PaperFileViewRef) =&gt; void</PaperCode></td>
                        <td>None</td>
                        <td>The handle below.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="ref">PaperFileViewRef</PaperText>
            <PaperTextList>
                <li><PaperCode>reload(folder?)</PaperCode> lists a folder on screen again, or every one; call it after a change the host made.</li>
                <li><PaperCode>rename(path)</PaperCode> starts renaming an entry in place, such as a folder just made.</li>
                <li><PaperCode>entry(path)</PaperCode> and <PaperCode>entries()</PaperCode> give the entries on screen, in the order the arrows walk them.</li>
                <li><PaperCode>focus()</PaperCode> gives the view the keyboard.</li>
                <li><PaperCode>step(1 | -1)</PaperCode> chooses the next or previous file, passing over folders, for arrows the host keeps while a preview is open.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="keys">Keys and pointer</PaperText>
            <PaperTextList>
                <li>Arrows move the choice, a row at a time in icons; Shift with an arrow or a click chooses a range, and ⌘ or Ctrl with a click adds or removes one.</li>
                <li>In a list, Right opens a folder in place and Left closes it, or moves to the folder above.</li>
                <li>⌘A or Ctrl+A chooses everything shown; Escape chooses nothing; typing a name's first letters chooses it.</li>
                <li>A drag on the empty space draws a box that chooses what it touches. On a touch screen a tap opens the entry instead.</li>
                <li>Keys the view doesn't use, such as Backspace, carry on to the host.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="thumbnails">Thumbnails</PaperText>
            <PaperText preset="body" as="p">
                The view asks <PaperCode>thumbnail</PaperCode> only for files near the screen, once each, and again when the file's size or time changes. <PaperCode>size</PaperCode> is the picture's longer edge in device pixels, <PaperCode>edge</PaperCode> is the box it is drawn in, in CSS pixels, and <PaperCode>signal</PaperCode> aborts when the entry leaves the view. Resolve null to keep the file's symbol. A rejection keeps the symbol too, as a broken picture with the reason on hover. The view makes and revokes the object URL of each picture itself.
            </PaperText>
            <PaperText preset="body" as="p">
                <PaperLink href="/docs/paperui/paperpreview/">PaperPreview</PaperLink>'s <PaperCode>paperPreviewThumbnail</PaperCode> makes one from any file address:
            </PaperText>
            <PaperCode block language="tsx">
{`import { paperPreviewThumbnail, previewKind, type PaperFileViewEntry, type PaperFileViewThumbnailOptions } from "@mileniumhq/paperui";

export async function thumbnail(entry: PaperFileViewEntry, options: PaperFileViewThumbnailOptions): Promise<Blob | null> {
    const kind = previewKind(entry.name);
    if (!kind) return null;
    return paperPreviewThumbnail({ src: \`/files/\${entry.path}\`, name: entry.name, kind }, { size: options.size, signal: options.signal });
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="drop-targets">Drop targets outside the view</PaperText>
            <PaperText preset="body" as="p">
                <PaperCode>createPaperFileViewDropTarget(onDrop)</PaperCode> makes the host's own places take drops the way the view's folders do, such as the parts of a path above the view. It returns <PaperCode>over()</PaperCode>, the folder a drag is over now, and <PaperCode>handlers(folder)</PaperCode>, the drag handlers to spread on an element.
            </PaperText>
            <PaperCode block language="tsx">
{`import { For } from "solid-js";
import { createPaperFileViewDropTarget, PaperButton, type PaperFileViewDrop } from "@mileniumhq/paperui";

export function Path(props: { folders: string[]; go: (folder: string) => void; drop: (drop: PaperFileViewDrop) => void }) {
    const target = createPaperFileViewDropTarget(props.drop);
    return (
        <For each={props.folders}>
            {(folder) => (
                <PaperButton variant="text" size="small" onClick={() => props.go(folder)} {...target.handlers(folder)}>
                    {folder || "Files"}
                </PaperButton>
            )}
        </For>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="helpers">Helpers</PaperText>
            <PaperTextList>
                <li><PaperCode>paperFileViewKind(entry)</PaperCode> gives the symbol, colour and kind name the view shows, from PaperPreview's kinds where it has a viewer.</li>
                <li><PaperCode>paperFileViewSize(entry)</PaperCode> and <PaperCode>paperFileViewDate(ms)</PaperCode> give the Size and Modified texts.</li>
                <li><PaperCode>sortPaperFileViewEntries(entries, sort)</PaperCode> sorts as the view does.</li>
                <li><PaperCode>paperFileViewParent(path)</PaperCode> and <PaperCode>paperFileViewInside(path, folder)</PaperCode> read paths.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
