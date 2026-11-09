import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import {
    PaperFileBrowser,
    type PaperFileContent,
    type PaperFileListing,
    type PaperFileSaveResult,
} from "../index";

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: Error) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const ROOT: PaperFileListing = {
    entries: [
        { name: "server.properties", path: "server.properties", kind: "file" },
        { name: "ops.json", path: "ops.json", kind: "file" },
    ],
};

/** A file owner whose answers the test decides, recording every call. */
function files(disk: Record<string, string>) {
    const versions: Record<string, number> = Object.fromEntries(Object.keys(disk).map((p) => [p, 1]));
    const reads: string[] = [];
    const writes: { path: string; text: string; version: string | undefined }[] = [];
    let nextWrite: Deferred<PaperFileSaveResult> | null = null;
    return {
        reads,
        writes,
        holdNextWrite() {
            nextWrite = deferred<PaperFileSaveResult>();
            return nextWrite;
        },
        list: async (path: string): Promise<PaperFileListing> => {
            expect(path).toBe("");
            return ROOT;
        },
        read: async (path: string): Promise<PaperFileContent> => {
            reads.push(path);
            return { kind: "text", text: disk[path], version: `v${versions[path]}` };
        },
        write: async (path: string, text: string, version: string | undefined): Promise<PaperFileSaveResult> => {
            writes.push({ path, text, version });
            const held = nextWrite;
            nextWrite = null;
            if (held) return held.promise;
            if (version !== `v${versions[path]}`) throw new Error(`${path} changed on disk since it was opened`);
            disk[path] = text;
            versions[path]++;
            return { version: `v${versions[path]}` };
        },
        changeOnDisk(path: string, text: string) {
            disk[path] = text;
            versions[path]++;
        },
    };
}

const editor = () => screen.getByLabelText(/^Contents of/) as HTMLTextAreaElement;
const typeInto = (text: string) => {
    editor().value = text;
    fireEvent.input(editor());
};
const row = (name: string) => screen.getByRole("treeitem", { name: new RegExp(name.replace(".", "\\.")) });
const toolbarSave = () => screen.getAllByRole("button", { name: /Save/ }).find((b) => !b.closest('[role="dialog"]'))!;
const dialog = () => screen.getByRole("dialog", { name: /Save changes to/ });

async function openFile(name: string) {
    await waitFor(() => row(name));
    fireEvent.click(row(name));
    await waitFor(() => expect(screen.getByLabelText(`Contents of ${name}`)).toBeTruthy());
}

// Inventory: Content, files and console — File browser save safety.
describe("PaperFileBrowser save safety", () => {
    test("a save passes the version that was read, then the version the save returned", async () => {
        const owner = files({ "server.properties": "motd=hi" });
        render(() => <PaperFileBrowser rootLabel="Server" list={owner.list} read={owner.read} write={owner.write} />);
        await openFile("server.properties");

        typeInto("motd=hello");
        fireEvent.click(toolbarSave());
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));
        typeInto("motd=hello again");
        fireEvent.click(toolbarSave());
        await waitFor(() => expect(owner.writes).toHaveLength(2));

        expect(owner.writes).toEqual([
            { path: "server.properties", text: "motd=hello", version: "v1" },
            { path: "server.properties", text: "motd=hello again", version: "v2" },
        ]);
    });

    test("a save refused because the file changed keeps the edits and offers Reload, which asks before discarding", async () => {
        const owner = files({ "server.properties": "motd=hi" });
        render(() => <PaperFileBrowser rootLabel="Server" list={owner.list} read={owner.read} write={owner.write} />);
        await openFile("server.properties");

        owner.changeOnDisk("server.properties", "motd=from the server");
        typeInto("motd=mine");
        fireEvent.click(toolbarSave());
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("changed on disk");
        expect(editor().value).toBe("motd=mine");
        expect(screen.getAllByLabelText("Unsaved changes").length).toBeGreaterThan(0);
        expect(toolbarSave().hasAttribute("disabled")).toBe(false);

        fireEvent.click(within(alert).getByRole("button", { name: /Reload from disk/ }));
        // asks first: nothing is read and the edits are still there
        expect(dialog()).toBeTruthy();
        expect(owner.reads).toEqual(["server.properties"]);
        expect(editor().value).toBe("motd=mine");

        fireEvent.click(within(dialog()).getByRole("button", { name: "Discard" }));
        await waitFor(() => expect(editor().value).toBe("motd=from the server"));
        expect(owner.reads).toEqual(["server.properties", "server.properties"]);
    });

    test("switching files with unsaved edits asks first, and Cancel stays put", async () => {
        const owner = files({ "server.properties": "motd=hi", "ops.json": "[]" });
        render(() => <PaperFileBrowser rootLabel="Server" list={owner.list} read={owner.read} write={owner.write} />);
        await openFile("server.properties");
        typeInto("motd=unsaved");

        fireEvent.click(row("ops.json"));
        expect(within(dialog()).getByText(/Save changes to server\.properties\?/)).toBeTruthy();
        expect(owner.reads).toEqual(["server.properties"]);

        fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
        expect(editor().getAttribute("aria-label")).toBe("Contents of server.properties");
        expect(editor().value).toBe("motd=unsaved");
        expect(owner.reads).toEqual(["server.properties"]);
    });

    test("cancelling the question while its save is in flight does not run the navigation", async () => {
        const owner = files({ "server.properties": "motd=hi", "ops.json": "[]" });
        render(() => <PaperFileBrowser rootLabel="Server" list={owner.list} read={owner.read} write={owner.write} />);
        await openFile("server.properties");
        typeInto("motd=first");

        fireEvent.click(row("ops.json"));
        const write = owner.holdNextWrite();
        fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(owner.writes).toHaveLength(1));
        fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
        write.resolve({ version: "v2" });

        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved"));
        expect(owner.writes).toEqual([{ path: "server.properties", text: "motd=first", version: "v1" }]);
        expect(owner.reads).toEqual(["server.properties"]);
        expect(editor().getAttribute("aria-label")).toBe("Contents of server.properties");
        expect(editor().value).toBe("motd=first");
    });

    test("edits typed while the question's save is in flight are kept, and the navigation waits", async () => {
        const owner = files({ "server.properties": "motd=hi", "ops.json": "[]" });
        render(() => <PaperFileBrowser rootLabel="Server" list={owner.list} read={owner.read} write={owner.write} />);
        await openFile("server.properties");
        typeInto("motd=first");

        fireEvent.click(row("ops.json"));
        const write = owner.holdNextWrite();
        fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(owner.writes).toHaveLength(1));
        typeInto("motd=typed while saving");
        write.resolve({ version: "v2" });

        await waitFor(() => expect(screen.queryByRole("dialog", { name: /Save changes to/ })).toBeNull());
        expect(owner.reads).toEqual(["server.properties"]);
        expect(editor().getAttribute("aria-label")).toBe("Contents of server.properties");
        expect(editor().value).toBe("motd=typed while saving");
        expect(screen.getAllByLabelText("Unsaved changes").length).toBeGreaterThan(0);
    });
});

// Inventory: Content, files and console — Failures are shown, not swallowed (file browser).
describe("PaperFileBrowser read failures", () => {
    test("a folder that can't be listed shows the error with a working Retry", async () => {
        let attempts = 0;
        const list = async (): Promise<PaperFileListing> => {
            attempts++;
            if (attempts === 1) throw new Error("Permission denied: /srv/world");
            return ROOT;
        };
        render(() => <PaperFileBrowser rootLabel="Server" list={list} read={async () => ({ kind: "text", text: "" })} />);

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toBe("Permission denied: /srv/world");
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => row("server.properties"));
        expect(attempts).toBe(2);
        expect(screen.queryByRole("alert")).toBeNull();
    });

    test("a file that can't be read shows the error with a working Try again", async () => {
        let attempts = 0;
        const read = async (): Promise<PaperFileContent> => {
            attempts++;
            if (attempts === 1) throw new Error("EIO: i/o error, read");
            return { kind: "text", text: "motd=hi" };
        };
        render(() => <PaperFileBrowser rootLabel="Server" list={async () => ROOT} read={read} />);
        await waitFor(() => row("server.properties"));
        fireEvent.click(row("server.properties"));

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("Couldn't open server.properties");
        expect(alert.textContent).toContain("EIO: i/o error, read");
        fireEvent.click(within(alert).getByRole("button", { name: /Try again/ }));
        await waitFor(() => expect(editor().value).toBe("motd=hi"));
        expect(attempts).toBe(2);
    });
});
