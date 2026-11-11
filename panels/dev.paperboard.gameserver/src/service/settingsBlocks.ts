// The blocks every game shares for its options and its files. Each runs the
// Action (v1) the Options and Files tabs run, so a block is checked exactly
// as an edit there is: the game's own rules, a busy server, a file the game
// keeps to itself.
import type { BlockSet, ServiceContext } from "@mileniumhq/paperapi";
import type { GameServerState } from "./types";
import { ACTION_IDS } from "./contract";
import { currentGame } from "../games/service";
import { runGameAction } from "./blocks";
import type { GameOption } from "../games/types";

type Context = ServiceContext<GameServerState>;

/** The options a block can read and set: every one the Options tab edits, its secrets left out. */
function editableOptions(ctx: Context): GameOption[] {
    const features = currentGame().describe({ software: ctx.state.serverSoftware, version: ctx.state.serverVersion, settings: ctx.state.gameSettings });
    return features.options.filter((option) => option.kind !== "secret");
}

function optionNamed(ctx: Context, id: string): GameOption {
    const option = editableOptions(ctx).find((o) => o.id === id);
    if (!option) throw new Error(`${currentGame().name} has no option "${id}" that blocks can change`);
    return option;
}

/**
 * What a block was given, as the option's own kind: a Text block's "true"
 * for a switch, "20" for a number. Anything else goes to the game's check
 * as it came, which says what the option takes.
 */
export function optionValue(option: GameOption, value: unknown): unknown {
    switch (option.kind) {
        case "boolean":
            return value === "true" ? true : value === "false" ? false : value;
        case "number":
        case "slider":
            return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
        case "select":
        case "text":
            return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
        case "secret":
            throw new Error(`${option.label} is a secret, which blocks don't set`);
    }
}

export function settingsBlocks(ctx: Context): BlockSet {
    const option = {
        type: "text",
        name: "Option",
        choices: () => editableOptions(ctx).map((o) => ({ label: o.label, value: o.id })),
    } as const;
    const file = { type: "text", name: "File" } as const;
    return {
        values: [
            {
                id: "option",
                name: "Option",
                category: "Options",
                icon: "tune",
                description: "What one of the server's options is set to, as the Options tab shows it",
                text: "{option} option",
                inputs: { option },
                type: "any",
                read: async ({ option: id }: { option: string }) => {
                    const checked = optionNamed(ctx, id);
                    const values = await runGameAction<Record<string, unknown>>(ctx, ACTION_IDS.readGameOptions, {});
                    if (!Object.hasOwn(values, checked.id)) throw new Error(`${checked.label} has no value yet`);
                    return values[checked.id];
                },
            },
            {
                id: "files",
                name: "Files in Folder",
                category: "Files",
                icon: "folder",
                description: "The paths of the files and folders in a folder of the server, folders first; an empty folder name is the server folder",
                text: "files in {folder}",
                inputs: { folder: { type: "text", name: "Folder", optional: true } },
                type: "list<text>",
                read: async ({ folder }: { folder?: string }) => {
                    const listing = await runGameAction<{ entries: { path: string; kind: "file" | "folder" }[]; note?: string }>(ctx, ACTION_IDS.listServerFiles, {
                        path: folder ?? "",
                    });
                    return listing.entries.map((entry) => (entry.kind === "folder" ? `${entry.path}/` : entry.path));
                },
            },
            {
                id: "file-text",
                name: "File Text",
                category: "Files",
                icon: "draft",
                description: "The text of one of the server's files, such as server.properties; at most 2 MB",
                text: "text of {file}",
                inputs: { file },
                type: "text",
                read: async ({ file: path }: { file: string }) => {
                    const content = await runGameAction<{ kind: string; text?: string; reason?: string }>(ctx, ACTION_IDS.readServerFile, { path });
                    if (content.kind === "unavailable") throw new Error(content.reason ?? `${path} can't be read as text`);
                    if (content.kind !== "text" || content.text === undefined) throw new Error(`${path} is not a text file`);
                    return content.text;
                },
            },
        ],
        commands: [
            {
                id: "set-option",
                name: "Set Option",
                category: "Options",
                icon: "tune",
                description: "Changes one of the server's options, as the Options tab does; some apply at once, the rest when the server next starts",
                text: "Set {option} to {value}",
                inputs: { option, value: { type: "any", name: "Value" } },
                run: async ({ option: id, value }: { option: string; value: unknown }) => {
                    const checked = optionNamed(ctx, id);
                    await runGameAction(ctx, ACTION_IDS.writeGameOptions, { patch: { [checked.id]: optionValue(checked, value) } });
                },
            },
            {
                id: "write-file",
                name: "Write File",
                category: "Files",
                icon: "save",
                description: "Replaces the text of one of the server's text files; the file must already be there",
                text: "Write {text} to {file}",
                inputs: { text: { type: "text", name: "Text" }, file },
                run: async ({ text, file: path }: { text: string; file: string }) => {
                    const content = await runGameAction<{ kind: string; version?: string; reason?: string }>(ctx, ACTION_IDS.readServerFile, { path });
                    if (content.kind === "unavailable") throw new Error(content.reason ?? `${path} can't be written as text`);
                    if (content.kind !== "text" || !content.version) throw new Error(`${path} is not a text file`);
                    await runGameAction(ctx, ACTION_IDS.writeServerFile, { path, text, version: content.version });
                },
            },
        ],
    };
}
