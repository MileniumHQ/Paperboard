// The open file: reading it, the edits held against what was read, saving
// them, and the question asked before unsaved edits would be lost.
import { batch, createSignal } from "solid-js";
import type { PaperEditorPosition } from "../../components/PaperEditor";
import { baseName } from "./files";
import { errorMessage } from "../../utils/errorMessage";
import type { PaperFileBrowserProps, PaperFileContent } from "./types";

type DocState =
    | { status: "idle" }
    | { status: "loading"; path: string }
    | { status: "error"; path: string; message: string }
    | { status: "ready"; path: string; content: PaperFileContent };

export interface Notice {
    tone: "success" | "danger";
    text: string;
    /** offers Reload from disk: the file on disk is not what the editor holds */
    reload?: boolean;
}

export function createFileDocument(props: Pick<PaperFileBrowserProps, "read" | "write">) {
    const [doc, setDoc] = createSignal<DocState>({ status: "idle" });
    const [buffer, setBuffer] = createSignal("");
    const [savedText, setSavedText] = createSignal("");
    const [version, setVersion] = createSignal<string | undefined>(undefined);
    const [saving, setSaving] = createSignal(false);
    const [notice, setNotice] = createSignal<Notice | null>(null);
    const [cursor, setCursor] = createSignal<PaperEditorPosition>({ line: 1, column: 1 });
    // the open question about unsaved edits; `settle` answers whoever asked it
    const [pending, setPending] = createSignal<{ name: string; settle: (go: boolean) => void } | null>(null);

    const openPath = () => {
        const state = doc();
        return state.status === "idle" ? null : state.path;
    };
    const textContent = () => {
        const state = doc();
        return state.status === "ready" && state.content.kind === "text" ? state.content : null;
    };
    const readOnlyReason = () => {
        const content = textContent();
        if (!content) return null;
        if (content.readOnly) return content.readOnly;
        if (!props.write) return "This browser is read-only";
        return null;
    };
    const editable = () => textContent() !== null && readOnlyReason() === null;
    const dirty = () => textContent() !== null && buffer() !== savedText();

    let readToken = 0;
    const load = async (path: string) => {
        const token = ++readToken;
        batch(() => {
            setDoc({ status: "loading", path });
            setNotice(null);
        });
        try {
            const content = await props.read(path);
            if (token !== readToken) return;
            batch(() => {
                setDoc({ status: "ready", path, content });
                const text = content.kind === "text" ? content.text : "";
                setBuffer(text);
                setSavedText(text);
                setVersion(content.kind === "text" ? content.version : undefined);
                setCursor({ line: 1, column: 1 });
            });
        } catch (err) {
            if (token !== readToken) return;
            setDoc({ status: "error", path, message: errorMessage(err) });
        }
    };

    /**
     * Asks what happens to the unsaved edits: true once they are saved or
     * discarded, false when the person keeps editing. A newer question
     * replaces an open one, which then answers false.
     */
    const ask = (path: string): Promise<boolean> =>
        new Promise((resolve) => {
            pending()?.settle(false);
            setPending({ name: baseName(path), settle: resolve });
        });

    /** closes the dialog with the person's answer */
    const answer = (go: boolean) => {
        const request = pending();
        setPending(null);
        request?.settle(go);
    };

    /** runs `action` now, or after the user decides what happens to unsaved edits */
    const guard = (action: () => void) => {
        const path = openPath();
        if (!dirty() || !path) return action();
        void ask(path).then((go) => {
            if (go) action();
        });
    };

    const confirmLeave = (): Promise<boolean> => {
        const path = openPath();
        return !dirty() || !path ? Promise.resolve(true) : ask(path);
    };

    /** opens `path` (asking first about unsaved edits); an open file stays as it is */
    const open = (path: string) => {
        if (openPath() === path && doc().status !== "error") return;
        guard(() => void load(path));
    };

    const close = () =>
        guard(() => {
            readToken++;
            setDoc({ status: "idle" });
            setNotice(null);
        });

    const save = async (): Promise<boolean> => {
        const path = openPath();
        if (!path || !props.write || !editable() || saving()) return false;
        const text = buffer();
        setSaving(true);
        setNotice(null);
        try {
            const result = await props.write(path, text, version());
            if (openPath() !== path) return true;
            batch(() => {
                setSavedText(text);
                setVersion(result.version);
                setNotice({ tone: "success", text: result.message ?? "Saved" });
            });
            return true;
        } catch (err) {
            if (openPath() === path) setNotice({ tone: "danger", text: errorMessage(err), reload: true });
            return false;
        } finally {
            setSaving(false);
        }
    };

    const revert = () => {
        setBuffer(savedText());
        setNotice(null);
    };

    const reloadFromDisk = () => {
        const path = openPath();
        if (path) guard(() => void load(path));
    };

    /** the person typed: the edit is held, and a "Saved" notice no longer holds */
    const edit = (value: string) => {
        setBuffer(value);
        if (notice()?.tone === "success") setNotice(null);
    };

    return {
        doc,
        buffer,
        edit,
        saving,
        notice,
        setNotice,
        cursor,
        setCursor,
        pending,
        openPath,
        textContent,
        readOnlyReason,
        editable,
        dirty,
        load,
        answer,
        confirmLeave,
        open,
        close,
        save,
        revert,
        reloadFromDisk,
    };
}
