// Drive's blocks for the Blocks panel: a flow lists, reads, writes and
// rearranges what is in the drive, through the same Drive the page uses.
import type { BlockSet } from "@mileniumhq/paperapi";
import { parentOf, type DriveEntry } from "./lib/contract";
import type { Drive } from "./lib/drive";

const CATEGORY = "Drive";

/** What the blocks change goes through `changed`, so open windows list those folders again. */
export function driveBlocks(drive: Drive, changed: (folders: string[]) => void): BlockSet {
    const done = (entry: DriveEntry, ...also: string[]) => {
        changed([parentOf(entry.path), ...also]);
        return entry.path;
    };
    return {
        categories: [{ name: CATEGORY, icon: "hard_drive" }],
        types: [
            {
                id: "item",
                name: "Drive Item",
                icon: "draft",
                description: "A file or folder in the drive, by its path from the drive's top, such as Photos/beach.jpg",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: async (path: string) => (await drive.stat(path)).name },
                    folder: {
                        type: "boolean",
                        name: "Is Folder",
                        resolve: async (path: string) => (await drive.stat(path)).kind === "folder",
                    },
                    size: {
                        type: "number",
                        name: "Size",
                        description: "A file's size in bytes; 0 for a folder",
                        resolve: async (path: string) => (await drive.stat(path)).size,
                    },
                    modified: { type: "timestamp", name: "Modified", resolve: async (path: string) => (await drive.stat(path)).modified },
                    parent: { type: "text", name: "Folder", description: "The folder it's in; empty at the drive's top", resolve: (path: string) => parentOf(path) },
                },
            },
        ],
        values: [
            {
                id: "files-in-folder",
                name: "Files in Folder",
                category: CATEGORY,
                icon: "folder_open",
                description: "The files and folders in a folder of the drive, folders first; leave the folder empty for the drive's top",
                text: "files in {folder}",
                inputs: { folder: { type: "text", name: "Folder", optional: true } },
                type: "list<item>",
                read: async ({ folder }: { folder?: string }) => {
                    const entries = await drive.list(folder ?? "");
                    return entries
                        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1))
                        .map((e) => e.path);
                },
            },
            {
                id: "text-of-file",
                name: "Text of File",
                category: CATEGORY,
                icon: "article",
                description: "What a text file in the drive says",
                text: "text of {file}",
                inputs: { file: { type: "item", name: "File" } },
                type: "text",
                read: ({ file }: { file: string }) => drive.readText(file),
            },
        ],
        commands: [
            {
                id: "create-folder",
                name: "Create Folder",
                category: CATEGORY,
                icon: "create_new_folder",
                description: "Makes a folder; leave the folder it goes in empty for the drive's top",
                text: "create a folder named {name} in {folder}",
                inputs: {
                    name: { type: "text", name: "Name" },
                    folder: { type: "text", name: "Folder", optional: true },
                },
                output: "item",
                run: async ({ name, folder }: { name: string; folder?: string }) => done(await drive.createFolder(folder ?? "", name)),
            },
            {
                id: "rename",
                name: "Rename",
                category: CATEGORY,
                icon: "edit",
                description: "Gives a file or folder a new name, in the folder it's in",
                text: "rename {item} to {name}",
                inputs: {
                    item: { type: "item", name: "Item" },
                    name: { type: "text", name: "Name" },
                },
                output: "item",
                run: async ({ item, name }: { item: string; name: string }) => done(await drive.rename(item, name)),
            },
            {
                id: "move",
                name: "Move",
                category: CATEGORY,
                icon: "drive_file_move",
                description: "Moves a file or folder into another folder; leave the folder empty for the drive's top",
                text: "move {item} into {folder}",
                inputs: {
                    item: { type: "item", name: "Item" },
                    folder: { type: "text", name: "Folder", optional: true },
                },
                output: "item",
                run: async ({ item, folder }: { item: string; folder?: string }) => {
                    const [moved] = await drive.move([item], folder ?? "");
                    return done(moved, parentOf(item));
                },
            },
            {
                id: "delete",
                name: "Delete",
                category: CATEGORY,
                icon: "delete",
                description: "Deletes a file, or a folder with everything in it, for good",
                text: "delete {item}",
                inputs: { item: { type: "item", name: "Item" } },
                run: async ({ item }: { item: string }) => {
                    await drive.delete([item]);
                    changed([parentOf(item)]);
                },
            },
            {
                id: "write-text-file",
                name: "Write Text File",
                category: CATEGORY,
                icon: "edit_document",
                description: "Writes text to a file, replacing what it held, and makes the folders on its path",
                text: "write {text} to {file}",
                inputs: {
                    text: { type: "text", name: "Text" },
                    file: { type: "text", name: "File" },
                },
                output: "item",
                run: async ({ text, file }: { text: string; file: string }) => {
                    const entry = await drive.writeText(file, text);
                    // a folder the write made shows in the one above it
                    const folders = new Set<string>();
                    for (let p = parentOf(entry.path); ; p = parentOf(p)) {
                        folders.add(p);
                        if (p === "") break;
                    }
                    changed([...folders]);
                    return entry.path;
                },
            },
        ],
    };
}
