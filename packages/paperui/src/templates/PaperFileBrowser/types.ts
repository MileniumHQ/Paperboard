// The shapes a host hands PaperFileBrowser, and what it gets back.

export interface PaperFileEntry {
    name: string;
    /** "/"-joined path from the browser's root ("" is the root itself) */
    path: string;
    kind: "file" | "folder";
    size?: number;
}

export interface PaperFileListing {
    entries: PaperFileEntry[];
    /** shown under the folder's entries, e.g. "Showing the first 500 of 1,204" */
    note?: string;
}

export type PaperFileContent =
    | {
          kind: "text";
          text: string;
          /** opaque token handed back to `write`, so a save can refuse a file that changed */
          version?: string;
          /** Prism language id; defaults to one picked from the extension */
          language?: string;
          /** set to say why this file opens read-only */
          readOnly?: string;
      }
    | { kind: "image"; src: string; alt?: string }
    | { kind: "unavailable"; reason: string };

export interface PaperFileSaveResult {
    version?: string;
    /** shown after saving, e.g. when the change takes effect */
    message?: string;
}

export interface PaperFileReveal {
    path: string;
    kind: "file" | "folder";
}

export interface PaperFileBrowserProps {
    /** names the root folder in the tree and the breadcrumb */
    rootLabel: string;
    list: (path: string) => Promise<PaperFileListing>;
    read: (path: string) => Promise<PaperFileContent>;
    /** omit for a read-only browser */
    write?: (path: string, text: string, version: string | undefined) => Promise<PaperFileSaveResult>;
    /**
     * Opens the tree to this path (and opens it, for a file). A new object
     * reveals again, so callers can repeat the same path.
     */
    reveal?: PaperFileReveal | null;
    /** syntax highlighting in the editor (default true) */
    highlight?: boolean;
    /** the editor's ⋮ file menu (default true) */
    fileMenu?: boolean;
    sideWidth?: number | string;
    class?: string;
    /** hands the host what it needs to guard leaving the browser */
    ref?: (browser: PaperFileBrowserRef) => void;
}

/** What a host asks a file browser before taking it away (a tab, a modal, a page). */
export interface PaperFileBrowserRef {
    /** whether the open file has edits that are not saved; reactive */
    dirty: () => boolean;
    /**
     * Asks the person what happens to unsaved edits, with the same Save /
     * Discard / Cancel dialog as switching files. Resolves true once they are
     * saved or discarded (at once when there are none), so the host may go
     * ahead; false when the person cancels or the save fails (its error shows
     * in the browser), so the host stays. Its shape fits onBeforeClose.
     */
    confirmLeave: () => Promise<boolean>;
}
