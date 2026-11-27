// The templates a new project can start with: built only from blocks that
// exist (Blockly loads every one of them), saying what they need when a panel
// isn't there, and running in the service as they are saved. Game Server's
// blocks are registered here the way it registers them, in PaperAPI's
// in-memory registry.
process.env.TZ = "America/New_York";

import { beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { memoryBlocks, type BlockInfo, type BlockProjectInfo } from "@mileniumhq/paperapi";
import { BUILTIN_BLOCKS, registryDefinitions } from "../src/lib/blockDefs";
import { registerChoicesField } from "../src/lib/choicesField";
import { readFlows } from "../src/lib/flows";
import { TEMPLATES, readChoices, type TemplateRegistry } from "../src/templates";
import { setup, until } from "./helpers/runtime";
import { testClock } from "./helpers/clock";

const GAME_SERVER = "dev.paperboard.gameserver";
const SERVERS = [
    { id: "s-survival", name: "Survival" },
    { id: "s-creative", name: "Creative" },
];

/** Game Server's blocks the templates use, registered as it registers them, with these servers. */
async function gameServer(servers = SERVERS): Promise<TemplateRegistry> {
    const registry = memoryBlocks(GAME_SERVER);
    await registry.panel.register({
        types: [
            {
                id: "server",
                name: "Server",
                base: "text",
                choices: () => servers.map((s) => ({ label: s.name, value: s.id })),
                fields: { name: { type: "text", name: "Name", resolve: (id: string) => servers.find((s) => s.id === id)!.name } },
            },
        ],
        commands: [{ id: "restart-server", name: "Restart Server", category: "Servers", text: "Restart {server}", inputs: { server: { type: "server", name: "Server" } }, run: async () => undefined }],
    });
    const projects: BlockProjectInfo[] = [];
    for (const server of servers) {
        const project = await registry.defineProject({ id: server.id, name: server.name });
        await project.register({
            events: [{ id: "backup-failed", name: "When a Backup Fails", category: "Backups", values: { error: { type: "text", name: "Error" } } }],
        });
        projects.push({ panelId: GAME_SERVER, id: server.id, name: server.name });
    }
    const entries = registry.list() as BlockInfo[];
    return { entries, projects, choices: await readChoices(entries, (typeRef) => registry.typeChoices(typeRef.slice(typeRef.indexOf(":") + 1))) };
}

const template = (id: string) => TEMPLATES.find((t) => t.id === id)!;
const built = (id: string, registry: TemplateRegistry) => {
    const made = template(id).build(registry);
    if ("unavailable" in made) throw new Error(`${id} is unavailable: ${made.unavailable}`);
    return made.flows;
};

beforeAll(() => {
    registerChoicesField({ fetch: async () => SERVERS.map((s) => ({ label: s.name, value: s.id })), report: (message) => { throw new Error(message); } });
});

describe("templates", () => {
    test("each is made of blocks that exist: Blockly loads it whole, from the blocks and the schemas saved with it", async () => {
        const registry = await gameServer();
        for (const t of TEMPLATES) {
            const flows = readFlows(built(t.id, registry));
            const defs = registryDefinitions(Object.values(flows.schemas).map((s) => ({ panelId: s.panelId, entry: s.entry, schema: s.schema })));
            for (const block of [...BUILTIN_BLOCKS, ...defs.blocks]) delete Blockly.Blocks[block.type as string];
            Blockly.common.defineBlocksWithJsonArray([...BUILTIN_BLOCKS, ...defs.blocks]);
            const ws = new Blockly.Workspace();
            try {
                Blockly.serialization.workspaces.load(flows.workspace, ws);
                expect(ws.getTopBlocks(false).length).toBe(flows.workspace.blocks!.blocks.length);
            } finally {
                ws.dispose();
            }
        }
    });

    test("one that needs Game Server says so when it isn't there, or has no servers", async () => {
        const none = { entries: [], projects: [], choices: await readChoices([], async () => []) };
        expect(template("nightly-restart").build(none)).toEqual({ unavailable: "Needs the Game Server panel" });
        expect(template("backup-failed").build(none)).toEqual({ unavailable: "Needs the Game Server panel" });
        const empty = await gameServer([]);
        expect(template("nightly-restart").build(empty)).toEqual({ unavailable: "Make a server in Game Server first" });
        expect(template("count-runs").build(none)).toHaveProperty("flows");
    });

    test("restarting every night restarts the first server at 04:00", async () => {
        const flows = built("nightly-restart", await gameServer());
        const time = testClock(new Date("2026-06-10T03:50:00"));
        const s = setup({ clock: time.clock, commands: { "restart-server": () => undefined } });
        await s.ready;
        const made = await s.call.createProject({ name: template("nightly-restart").name, flows });
        expect(made).toMatchObject({ name: "Restart a game server every night", flowCount: 1, draft: false });
        await time.to(new Date("2026-06-10T04:01:00"));
        expect(s.ran).toEqual([{ panelId: GAME_SERVER, command: "restart-server", inputs: { server: "s-survival" } }]);
    });

    test("logging a failed backup listens to each server's, and says which", async () => {
        const flows = built("backup-failed", await gameServer());
        const s = setup();
        await s.ready;
        const { id } = await s.call.createProject({ name: template("backup-failed").name, flows });
        s.fire(`${GAME_SERVER} s-creative/event.backup-failed`, { error: "the disk is full" });
        await until("the log line", () => s.said(id).length === 1);
        expect(s.said(id)).toEqual(["info: Creative's backup failed: the disk is full"]);
    });

    test("counting runs with Data counts on from where it was after a restart", async () => {
        const flows = built("count-runs", { entries: [], projects: [], choices: {} });
        const s = setup();
        await s.ready;
        const { id } = await s.call.createProject({ name: template("count-runs").name, flows });
        await s.call.runFlows({ project: id });
        await until("the first run", () => s.said(id).length === 1);
        const after = setup({ files: s.files });
        await after.ready;
        await after.call.runFlows({ project: id });
        await until("the run after the restart", () => after.said(id).length === 1);
        expect([...s.said(id), ...after.said(id)]).toEqual(["info: Runs so far: 1", "info: Runs so far: 2"]);
    });
});

