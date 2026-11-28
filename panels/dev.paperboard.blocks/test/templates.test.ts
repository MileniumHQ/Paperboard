// The templates a new project can start with: Blocks' own, and the ones a
// panel registers, built from the blocks the registry has (Blockly loads
// every one of them), saying what they need when they can't be made yet,
// and running in the service as they are saved. The panel here registers
// its blocks and templates the way any panel does, in PaperAPI's in-memory
// registry.
process.env.TZ = "America/New_York";

import { beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { memoryBlocks, type BlockProjectInfo, type BlockTemplateDefinition } from "@mileniumhq/paperapi";
import { BUILTIN_BLOCKS, registryDefinitions } from "../src/lib/blockDefs";
import { registerChoicesField } from "../src/lib/choicesField";
import { readFlows } from "../src/lib/flows";
import { OWN_TEMPLATES, buildTemplate, readChoices, type TemplateRegistry } from "../src/templates";
import type { SavedFlows } from "../src/panel";
import { setup, until } from "./helpers/runtime";
import { testClock } from "./helpers/clock";

const PANEL = "dev.test.servers";
const SERVERS = [
    { id: "s-survival", name: "Survival" },
    { id: "s-creative", name: "Creative" },
];
const TEMPLATES: BlockTemplateDefinition[] = [
    {
        id: "nightly-restart",
        name: "Restart a server every night",
        description: "Every day at 04:00, restarts your first game server. Pick another on its block",
        icon: "restart_alt",
        needs: "server",
        when: { everyDay: "04:00" },
        steps: [{ command: "restart-server" }],
    },
    {
        id: "backup-failed",
        name: "Log when a backup fails",
        description: "Says which server's backup failed, and why",
        icon: "error",
        needs: "server",
        eachProject: true,
        when: { event: "backup-failed" },
        steps: [{ log: "{project}'s backup failed: {error}" }],
    },
];

/** The panel's blocks and templates, with these servers; `listing` is how its servers are listed. */
async function servers(options: { servers?: typeof SERVERS; templates?: BlockTemplateDefinition[]; listing?: () => { label: string; value: string }[] } = {}): Promise<TemplateRegistry> {
    const list = options.servers ?? SERVERS;
    const registry = memoryBlocks(PANEL);
    await registry.panel.register({
        types: [
            {
                id: "server",
                name: "Server",
                base: "text",
                choices: options.listing ?? (() => list.map((s) => ({ label: s.name, value: s.id }))),
                fields: { name: { type: "text", name: "Name", resolve: (id: string) => list.find((s) => s.id === id)!.name } },
            },
        ],
        commands: [{ id: "restart-server", name: "Restart Server", category: "Servers", text: "Restart {server}", inputs: { server: { type: "server", name: "Server" } }, run: async () => undefined }],
        events: [
            {
                id: "server-started",
                name: "When a Server Starts",
                text: "When {server} starts",
                inputs: { server: { type: "server", name: "Server", optional: true } },
                values: { server: { type: "server", name: "Server" } },
                filters: { server: "server" },
            },
        ],
        templates: options.templates ?? TEMPLATES,
    });
    const projects: BlockProjectInfo[] = [];
    for (const server of list) {
        const project = await registry.defineProject({ id: server.id, name: server.name });
        await project.register({
            events: [{ id: "backup-failed", name: "When a Backup Fails", category: "Backups", values: { error: { type: "text", name: "Error" } } }],
        });
        projects.push({ panelId: PANEL, id: server.id, name: server.name });
    }
    const templates = registry.templates();
    return {
        entries: registry.list(),
        projects,
        templates,
        panelNames: { [PANEL]: "Servers" },
        choices: await readChoices(templates, (typeRef) => registry.typeChoices(typeRef.slice(typeRef.indexOf(":") + 1))),
    };
}

const made = (registry: TemplateRegistry, id: string) => buildTemplate(registry.templates.find((t) => t.template.id === id)!, registry);
const built = (registry: TemplateRegistry, id: string): SavedFlows => {
    const answer = made(registry, id);
    if ("unavailable" in answer) throw new Error(`${id} is unavailable: ${answer.unavailable}`);
    return answer.flows;
};
const own = (key: string): SavedFlows => {
    const answer = OWN_TEMPLATES.find((t) => t.key === key)!.build();
    if ("unavailable" in answer) throw new Error(answer.unavailable);
    return answer.flows;
};

beforeAll(() => {
    registerChoicesField({ fetch: async () => SERVERS.map((s) => ({ label: s.name, value: s.id })), report: (message) => { throw new Error(message); } });
});

describe("templates", () => {
    test("each is made of blocks that exist: Blockly loads it whole, from the blocks and the schemas saved with it", async () => {
        const registry = await servers();
        const all = [...registry.templates.map((t) => built(registry, t.template.id)), ...OWN_TEMPLATES.map((t) => own(t.key))];
        for (const saved of all) {
            const flows = readFlows(saved);
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

    test("one that needs a panel's type says so until the type lists a value, or when listing it fails", async () => {
        const none = await servers({ servers: [] });
        expect(made(none, "nightly-restart")).toEqual({ unavailable: "Make a server in Servers first" });
        expect(made(none, "backup-failed")).toEqual({ unavailable: "Make a server in Servers first" });
        const broken = await servers({ listing: () => { throw new Error("the server list is unreadable"); } });
        expect(made(broken, "nightly-restart")).toEqual({ unavailable: "Couldn't list the server values: the server list is unreadable" });
    });

    test("one naming a block or value its panel doesn't have says so, instead of leaving it off the canvas", async () => {
        const base = TEMPLATES[0]!;
        const registry = await servers({
            templates: [
                { ...base, id: "gone", steps: [{ command: "reinstall-server" }] },
                { ...base, id: "no-input", steps: [{ command: "restart-server", inputs: { world: "main" } }] },
                { ...base, id: "no-value", eachProject: true, when: { event: "backup-failed" }, steps: [{ log: "{size} bytes" }] },
            ],
        });
        expect(made(registry, "gone")).toEqual({ unavailable: 'Servers has no command "reinstall-server"; update it' });
        expect(made(registry, "no-input")).toEqual({ unavailable: 'Restart Server has no input "world"' });
        expect(made(registry, "no-value")).toEqual({ unavailable: "Restart a server every night logs {size}, which its event doesn't fire" });
    });

    test("a required input of the type it needs starts as the first value; an optional one stays any", async () => {
        const registry = await servers({ templates: [{ ...TEMPLATES[0]!, id: "restart-on-start", when: { event: "server-started" } }] });
        const [hat] = built(registry, "restart-on-start").workspace.blocks!.blocks;
        expect(hat!.inputs!.server!.shadow!.fields).toBeUndefined();
        expect(hat!.inputs!.DO!.block!.inputs!.server!.shadow!.fields).toEqual({ VALUE: JSON.stringify("s-survival") });
    });

    test("restarting every night restarts the first server the type lists at 04:00", async () => {
        const flows = built(await servers(), "nightly-restart");
        const time = testClock(new Date("2026-06-10T03:50:00"));
        const s = setup({ clock: time.clock, commands: { "restart-server": () => undefined } });
        await s.ready;
        const project = await s.call.createProject({ name: "Restart a server every night", flows });
        expect(project).toMatchObject({ flowCount: 1, draft: false });
        await time.to(new Date("2026-06-10T04:01:00"));
        expect(s.ran).toEqual([{ panelId: PANEL, command: "restart-server", inputs: { server: "s-survival" } }]);
    });

    test("one made for each project listens in each, and names the project it heard from", async () => {
        const flows = built(await servers(), "backup-failed");
        expect(flows.workspace.blocks!.blocks).toHaveLength(2);
        const s = setup();
        await s.ready;
        const { id } = await s.call.createProject({ name: "Log when a backup fails", flows });
        s.fire(`${PANEL} s-creative/event.backup-failed`, { error: "the disk is full" });
        await until("the log line", () => s.said(id).length === 1);
        expect(s.said(id)).toEqual(["info: Creative's backup failed: the disk is full"]);
    });

    test("counting runs with Data counts on from where it was after a restart", async () => {
        const s = setup();
        await s.ready;
        const { id } = await s.call.createProject({ name: "Count runs with Data", flows: own("count-runs") });
        await s.call.runFlows({ project: id });
        await until("the first run", () => s.said(id).length === 1);
        const after = setup({ files: s.files });
        await after.ready;
        await after.call.runFlows({ project: id });
        await until("the run after the restart", () => after.said(id).length === 1);
        expect([...s.said(id), ...after.said(id)]).toEqual(["info: Runs so far: 1", "info: Runs so far: 2"]);
    });
});
