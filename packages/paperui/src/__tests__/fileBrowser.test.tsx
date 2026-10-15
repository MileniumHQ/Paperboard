import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, waitFor, within, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import {
    PaperFileBrowser,
    paperFileIcon,
    paperFileLanguage,
    ancestorPaths,
    type PaperFileContent,
    type PaperFileListing,
    type PaperFileReveal,
} from "../templates/PaperFileBrowser";

// an in-memory tree standing in for whatever owns the files
function fakeFiles(tree: Record<string, string | null>) {
    const files = new Map(Object.entries(tree));
    const versions = new Map<string, number>();
    const list = vi.fn(async (dir: string): Promise<PaperFileListing> => {
        const prefix = dir ? `${dir}/` : "";
        const names = new Map<string, "file" | "folder">();
        for (const path of files.keys()) {
            if (!path.startsWith(prefix)) continue;
            const rest = path.slice(prefix.length);
            const [head, ...tail] = rest.split("/");
            if (!head) continue;
            names.set(head, tail.length > 0 || files.get(path) === null ? "folder" : "file");
        }
        return {
            entries: [...names].map(([name, kind]) => ({ name, kind, path: prefix + name })),
        };
    });
    const read = vi.fn(async (path: string): Promise<PaperFileContent> => {
        const text = files.get(path);
        if (typeof text !== "string") throw new Error(`no such file ${path}`);
        return { kind: "text", text, version: String(versions.get(path) ?? 0) };
    });
    const write = vi.fn(async (path: string, text: string, version: string | undefined) => {
        if (version !== String(versions.get(path) ?? 0)) throw new Error("This file changed on disk since you opened it.");
        files.set(path, text);
        versions.set(path, (versions.get(path) ?? 0) + 1);
        return { version: String(versions.get(path)), message: "Saved. Restart the server to apply it." };
    });
    return { files, versions, list, read, write };
}

const TREE = {
    "server.properties": "motd=hi\n",
    "plugins/Essentials/config.yml": "nickname-prefix: '~'\n",
    "plugins/Essentials/kits.yml": "kits: {}\n",
    "plugins/LuckPerms/config.yml": "server: global\n",
};

async function treeItem(getByRole: (role: string, opts: object) => HTMLElement, name: string) {
    // a row with unsaved edits is announced as "name Unsaved changes"
    const pattern = new RegExp(`\\b${name.replace(".", "\\.")}( Unsaved changes)?$`);
    return waitFor(() => getByRole("treeitem", { name: pattern }));
}

describe("file icons and languages", () => {
    test("config formats, archives and folders get their own icons", () => {
        expect(paperFileIcon("config.yml", "file")).toBe("settings");
        expect(paperFileIcon("EssentialsX.jar", "file")).toBe("folder_zip");
        expect(paperFileIcon("server-icon.png", "file")).toBe("image");
        expect(paperFileIcon("database.mv.db", "file")).toBe("database");
        expect(paperFileIcon("noext", "file")).toBe("draft");
        expect(paperFileIcon("plugins", "folder", true)).toBe("folder_open");
    });

    test("a format without a grammar still has a truthful label", () => {
        expect(paperFileLanguage("core.conf")).toEqual({ label: "Config" });
        expect(paperFileLanguage("config.yml")).toEqual({ id: "yaml", label: "YAML" });
        expect(paperFileLanguage("README")).toEqual({ label: "Plain text" });
    });

    test("ancestorPaths walks down from the root", () => {
        expect(ancestorPaths("plugins/Essentials")).toEqual(["plugins", "plugins/Essentials"]);
        expect(ancestorPaths("")).toEqual([]);
    });
});

describe("PaperFileBrowser", () => {
    test("lists the root as a tree, folders first-class with aria-expanded", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole } = render(() => <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />);
        const plugins = await treeItem(getByRole, "plugins");
        expect(getByRole("tree", { name: "Server files" })).toBeTruthy();
        expect(plugins.getAttribute("aria-expanded")).toBe("false");
        expect((await treeItem(getByRole, "server.properties")).getAttribute("aria-expanded")).toBeNull();

        fireEvent.click(plugins);
        await treeItem(getByRole, "Essentials");
        expect(plugins.getAttribute("aria-expanded")).toBe("true");
        expect(fs.list).toHaveBeenCalledWith("plugins");
    });

    test("opens a text file in the editor and saves it with the version it read", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole, findByRole } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} write={fs.write} />
        ));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        const box = (await findByRole("textbox", { name: "Contents of server.properties" })) as HTMLTextAreaElement;
        expect(box.value).toBe("motd=hi\n");

        const save = getByRole("button", { name: "Save" }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        box.value = "motd=hello\n";
        fireEvent.input(box);
        expect(save.disabled).toBe(false);
        fireEvent.click(save);

        await findByRole("status");
        expect(fs.write).toHaveBeenCalledWith("server.properties", "motd=hello\n", "0");
        expect(getByRole("status").textContent).toContain("Restart the server to apply it.");
        expect(save.disabled).toBe(true);
    });

    test("a refused save stays unsaved and offers Reload from disk", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole, findByRole } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} write={fs.write} />
        ));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        const box = (await findByRole("textbox")) as HTMLTextAreaElement;
        // the server rewrote the file after it was opened
        fs.versions.set("server.properties", 5);
        box.value = "motd=mine\n";
        fireEvent.input(box);
        fireEvent.click(getByRole("button", { name: "Save" }));

        const alert = await findByRole("alert");
        expect(alert.textContent).toContain("changed on disk");
        expect((getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(within(alert).getByRole("button", { name: /Reload from disk/ }));
        // unsaved edits are not thrown away without asking
        await screen.findByRole("dialog");
    });

    test("switching files with unsaved edits asks first; Cancel keeps them, Discard moves on", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole, findByRole, queryByRole } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} write={fs.write} />
        ));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        const box = (await findByRole("textbox")) as HTMLTextAreaElement;
        box.value = "motd=draft\n";
        fireEvent.input(box);

        fireEvent.click(await treeItem(getByRole, "plugins"));
        fireEvent.click(await treeItem(getByRole, "LuckPerms"));
        fireEvent.click(await treeItem(getByRole, "config.yml"));
        const dialog = await screen.findByRole("dialog");
        expect(dialog.textContent).toContain("Save changes to server.properties?");

        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(((await findByRole("textbox")) as HTMLTextAreaElement).value).toBe("motd=draft\n");

        fireEvent.click(await treeItem(getByRole, "config.yml"));
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard" }));
        await waitFor(() =>
            expect((getByRole("textbox") as HTMLTextAreaElement).value).toBe("server: global\n"),
        );
        expect(fs.write).not.toHaveBeenCalled();
    });

    test("reveal opens the folders down to a file and opens it", async () => {
        const fs = fakeFiles(TREE);
        const [reveal, setReveal] = createSignal<PaperFileReveal | null>(null);
        const { getByRole, findByRole } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} reveal={reveal()} />
        ));
        setReveal({ path: "plugins/Essentials/config.yml", kind: "file" });
        const box = (await findByRole("textbox")) as HTMLTextAreaElement;
        expect(box.value).toBe("nickname-prefix: '~'\n");
        expect(fs.list).toHaveBeenCalledWith("plugins/Essentials");
        const item = await treeItem(getByRole, "config.yml");
        expect(item.getAttribute("aria-selected")).toBe("true");
        expect(item.getAttribute("aria-level")).toBe("3");
    });

    test("without write the editor is read-only and says why", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole, findByRole, queryByRole, getByText } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />
        ));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        expect(((await findByRole("textbox")) as HTMLTextAreaElement).readOnly).toBe(true);
        expect(queryByRole("button", { name: "Save" })).toBeNull();
        expect(getByText("This browser is read-only")).toBeTruthy();
    });

    test("a folder that cannot be listed shows why, and Retry lists it again", async () => {
        const fs = fakeFiles(TREE);
        fs.list.mockRejectedValueOnce(new Error("Permission denied"));
        const { findByRole, getByRole } = render(() => <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />);
        expect((await findByRole("alert")).textContent).toContain("Permission denied");
        fireEvent.click(getByRole("button", { name: "Retry" }));
        await treeItem(getByRole, "plugins");
    });

    test("a file that cannot be read shows the reason and a Try again action", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole, findByRole } = render(() => <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />);
        fs.read.mockRejectedValueOnce(new Error("The file is larger than 2 MB"));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        expect((await findByRole("alert")).textContent).toContain("larger than 2 MB");
        fireEvent.click(getByRole("button", { name: /Try again/ }));
        await findByRole("textbox");
    });

    test("arrow keys move through rows and Right opens a folder", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole } = render(() => <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />);
        const plugins = await treeItem(getByRole, "plugins");
        // one tab stop: the first row
        expect((await treeItem(getByRole, "server.properties")).tabIndex).toBe(0);
        expect(plugins.tabIndex).toBe(-1);
        // keys come from the focused row, not from the container
        fireEvent.keyDown(await treeItem(getByRole, "server.properties"), { key: "ArrowDown" });
        expect(plugins.tabIndex).toBe(0);
        fireEvent.keyDown(plugins, { key: "ArrowRight" });
        await treeItem(getByRole, "Essentials");
        expect(plugins.getAttribute("aria-expanded")).toBe("true");
        fireEvent.keyDown(plugins, { key: "ArrowLeft" });
        expect(plugins.getAttribute("aria-expanded")).toBe("false");
    });

    test("Enter and Space on a folder's Retry button are the button's, not the tree's", async () => {
        const fs = fakeFiles(TREE);
        const { getByRole } = render(() => <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} />);
        const plugins = await treeItem(getByRole, "plugins");
        fs.list.mockRejectedValueOnce(new Error("Permission denied"));
        fireEvent.click(plugins);
        const retry = await screen.findByRole("button", { name: "Retry" });
        for (const key of ["Enter", " "]) {
            // fireEvent returns false when the key's default action was prevented
            expect(fireEvent.keyDown(retry, { key })).toBe(true);
        }
        expect(fs.read).not.toHaveBeenCalled();
    });

    test("Cancel while Save is in flight keeps the newer edits instead of moving on", async () => {
        const fs = fakeFiles(TREE);
        let finishWrite!: () => void;
        const gate = new Promise<void>((resolve) => (finishWrite = resolve));
        const slowWrite = vi.fn(async (path: string, text: string, version: string | undefined) => {
            await gate;
            return fs.write(path, text, version);
        });
        const { getByRole, findByRole } = render(() => (
            <PaperFileBrowser rootLabel="Server" list={fs.list} read={fs.read} write={slowWrite} />
        ));
        fireEvent.click(await treeItem(getByRole, "server.properties"));
        const box = (await findByRole("textbox")) as HTMLTextAreaElement;
        box.value = "motd=draft\n";
        fireEvent.input(box);

        fireEvent.click(await treeItem(getByRole, "plugins"));
        fireEvent.click(await treeItem(getByRole, "LuckPerms"));
        fireEvent.click(await treeItem(getByRole, "config.yml"));
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(slowWrite).toHaveBeenCalled());

        // the user changes their mind and keeps typing
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        box.value = "motd=newer\n";
        fireEvent.input(box);

        finishWrite();
        await waitFor(() => expect(fs.write).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect((getByRole("textbox") as HTMLTextAreaElement).value).toBe("motd=newer\n");
        expect(fs.read).not.toHaveBeenCalledWith("plugins/LuckPerms/config.yml");
    });
});
