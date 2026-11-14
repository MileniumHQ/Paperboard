// The file File > Export writes and File > Import reads: what one Blocks
// writes, another reads back as the same flows, and any other file is
// refused with a reason a person can act on.
import { describe, expect, test } from "bun:test";
import { FLOW_FILE_FORMAT, FLOW_FILE_VERSION, flowFileText, parseFlowFile } from "../src/lib/flowFile";
import type { SavedFlows } from "../src/panel";

const saved: SavedFlows = {
    workspace: { blocks: { languageVersion: 0, blocks: [{ type: "pb_game_join", id: "hat", x: 10, y: 20, fields: { PLAYER: "alice" } }] } },
    schemas: { pb_game_join: { panelId: "dev.paperboard.game", entry: "event.joined", schema: { name: "When a Player Joins" } } },
};
const file = (fields: Record<string, unknown>) => JSON.stringify({ format: FLOW_FILE_FORMAT, version: FLOW_FILE_VERSION, ...saved, ...fields });

describe("a flow file", () => {
    test("reads back as the flows it was written from", () => {
        expect(parseFlowFile(flowFileText(saved))).toEqual(saved);
    });

    test.each([
        ["text that isn't JSON", "{ not json", "This file isn't a Blocks flow file: it isn't JSON."],
        ["JSON that is no object", "null", "This file isn't a Blocks flow file."],
        ["another program's file", file({ format: "something-else" }), "This file isn't a Blocks flow file."],
        ["a file with no version", file({ version: undefined }), "This Blocks flow file has no version, so it can't be read."],
        ["a newer Blocks' file", file({ version: FLOW_FILE_VERSION + 1 }), `This file was made by a newer version of Blocks (version ${FLOW_FILE_VERSION + 1}); update Blocks to import it.`],
        ["a file with no blocks", file({ workspace: {} }), "This flow file has no blocks in it."],
        ["a file with an empty canvas", file({ workspace: { blocks: { languageVersion: 0, blocks: [] } } }), "This flow file has no blocks in it."],
    ])("refuses %s", (_what, text, reason) => {
        expect(() => parseFlowFile(text)).toThrow(reason);
    });
});
