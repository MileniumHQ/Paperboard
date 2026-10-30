import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, config, getTransport } from "@mileniumhq/paperapi";
import { commandTriggerId } from "../../../panels/dev.paperboard.botcreator/src/types";

const ACTIONS = "dev.paperboard.actions";

test("Actions projects over the real daemon: the old canvas becomes a project, flows run per project, and programs edit flows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flow-wire-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const token = auth.issuePanelToken(ACTIONS);
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    const offs: (() => void)[] = [];
    let bot: WebSocket | undefined;
    try {
        await initPaperApi({ port: (wss.address() as any).port, token, computerId: "local", panelId: ACTIONS });
        const flows = ["first", "second"].map((id) => ({ id, panelId: "dev.paperboard.botcreator", pos: { x: 0, y: 0 }, isTrigger: true,
            action: { id: "on-message", name: "On message" }, values: {}, children: [] }));
        const commands = flows.map((flow, i) => ({ ...flow,
            action: { id: commandTriggerId({ scope: "global", name: i === 0 ? "first" : "second" }), name: "Slash command" } }));
        // the one canvas from before projects
        const legacy = { flows: [commands[0]], notes: [], functions: [] };
        await config.set(legacy, ACTIONS, "canvas.json");

        const { actionsService } = await import("../../../panels/dev.paperboard.actions/src/service");
        await actionsService.ready;

        // it became the project "My flows", and canvas.json stayed as it was
        const listed = await actionsApi.call<any[]>(ACTIONS, "list-projects");
        expect(listed.map((p) => [p.name, p.enabled, p.flowCount])).toEqual([["My flows", true, 1]]);
        const mine = listed[0].id as string;
        expect(await config.get(ACTIONS, "canvas.json")).toEqual(legacy);
        expect((await config.get<any>(ACTIONS, `projects/${mine}.json`)).flows).toEqual([commands[0]]);
        expect((await config.get<any>(ACTIONS, "projects.json")).projects.map((p: any) => p.name)).toEqual(["My flows"]);

        // the project is an Actions API project; its program-facing actions
        // are hidden from the Library, its window plumbing is internal
        expect((await actionsApi.listProjects(ACTIONS)).map((p) => [p.id, p.name])).toEqual([[mine, "My flows"]]);
        const own = await actionsApi.list(ACTIONS);
        const addFlow = own.find((a) => a.action === `${mine}/add-flow`)!;
        expect(addFlow.project).toBe(mine);
        expect(addFlow.schema?.hidden).toBe(true);
        expect(own.find((a) => a.action === `${mine}/save-canvas`)!.schema?.internal).toBe(true);

        const starts: string[] = [];
        offs.push(actionsApi.onTrigger(ACTIONS, "flow-start", (data: any) => starts.push(data.triggerBlockId)));
        await getTransport("local").call("system:info");
        // the event comes from botcreator's own credential: a panel can only
        // emit triggers under its own claim (tests/actionIdentity.test.ts)
        bot = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
        await once(bot, "open");
        let request = 0;
        // Bot Creator's "On message" event, as the registry offers it to programs
        bot.send(JSON.stringify({ id: ++request, action: "actions:register", params: { token: auth.issuePanelToken("dev.paperboard.botcreator"), panelId: "dev.paperboard.botcreator", action: "on-message", schema: { id: "on-message", name: "On message", description: "", eventOnly: true } } }));
        const [registered] = await once(bot, "message");
        expect(JSON.parse(String(registered)).error).toBeUndefined();
        const emit = async (trigger: string, expected: string[]) => {
            starts.length = 0;
            bot!.send(JSON.stringify({ id: ++request, action: "triggers:emit", params: { token: auth.issuePanelToken("dev.paperboard.botcreator"), panelId: "dev.paperboard.botcreator", trigger, output: { content: "fixture" } } }));
            const [ack] = await once(bot!, "message");
            expect(JSON.parse(String(ack)).error).toBeUndefined();
            const deadline = Date.now() + 2000;
            while (starts.length < expected.length && Date.now() < deadline) await Bun.sleep(5);
            await Bun.sleep(30);
            expect(starts.sort()).toEqual(expected.sort());
        };
        const save = async (projectId: string, canvas: any, clientId = "window") => {
            const base = await actionsApi.call<any>(ACTIONS, `${projectId}/get-canvas`);
            return actionsApi.call<any>(ACTIONS, `${projectId}/save-canvas`, { canvas, baseRevision: base.revision, clientId });
        };

        await emit(commands[0].action.id, ["first"]);
        await save(mine, { flows: commands, notes: [], functions: [] });
        await emit(commands[1].action.id, ["second"]);
        await emit(commands[0].action.id, ["first"]);
        await save(mine, { flows, notes: [], functions: [] });
        await emit("on-message", ["first", "second"]);

        // a flow that could never fire is refused, and nothing is written
        await expect(save(mine, { flows: [{ ...commands[0], action: { ...commands[0].action, match: { field: "commandName", input: "name" } }, values: {} }], notes: [], functions: [] }))
            .rejects.toThrow("would never fire");
        expect((await config.get<any>(ACTIONS, `projects/${mine}.json`)).flows).toEqual(flows);

        // A real action-dispatch failure must reach the editor's narrow
        // flow-log channel, even though the runtime returns an error log.
        const errors: any[] = [];
        offs.push(actionsApi.onTrigger(ACTIONS, "flow-log", (data: any) => errors.push(data)));
        const broken = { ...commands[0], children: [{ id: "reply", panelId: "dev.paperboard.botcreator", pos: { x: 0, y: 0 },
            isTrigger: false, action: { id: "missing-reply", name: "Reply to command" }, values: {} }] };
        await save(mine, { flows: [broken], notes: [], functions: [] });
        await emit(commands[0].action.id, ["first"]);
        const errorDeadline = Date.now() + 2000;
        while (errors.length === 0 && Date.now() < errorDeadline) await Bun.sleep(5);
        expect(errors).toHaveLength(1);
        expect(errors[0].status).toBe("error");
        expect(errors[0].message).toContain('Failed at step "Reply to command"');

        // Canvas edits travel through the service: a save on the current
        // revision lands, is applied and is announced to every window with
        // its project; a save made on an older revision is refused.
        const announced: any[] = [];
        offs.push(actionsApi.on(ACTIONS, "canvas-changed", (change: any) => announced.push(change)));
        await getTransport("local").call("system:info");
        const base = await actionsApi.call<any>(ACTIONS, `${mine}/get-canvas`);
        const windowOne = { flows, notes: [{ id: "n", pos: { x: 0, y: 0 }, text: "from window one" }], functions: [] };
        const saved = await actionsApi.call<any>(ACTIONS, `${mine}/save-canvas`, { canvas: windowOne, baseRevision: base.revision, clientId: "window-one" });
        expect(Object.keys(saved)).toEqual(["revision"]);
        expect(saved.revision).toBeGreaterThan(base.revision);
        await expect(actionsApi.call(ACTIONS, `${mine}/save-canvas`, { canvas: { flows: [], notes: [], functions: [] }, baseRevision: base.revision, clientId: "window-two" }))
            .rejects.toThrow("canvas-conflict");
        expect((await config.get<any>(ACTIONS, `projects/${mine}.json`)).notes[0].text).toBe("from window one");
        const announceDeadline = Date.now() + 2000;
        while (announced.length === 0 && Date.now() < announceDeadline) await Bun.sleep(5);
        expect(announced).toEqual([{ revision: saved.revision, clientId: "window-one", project: mine }]);
        await emit("on-message", ["first", "second"]);

        // a second project: a program builds a flow in it, placed clear of the others
        const other = await actionsApi.call<any>(ACTIONS, "create-project", { name: "Discord bot" });
        expect(other.name).toBe("Discord bot");
        const projectAdd = (flow: unknown) => actionsApi.call<any>(ACTIONS, `${other.id}/add-flow`, { flow });
        const one = await projectAdd({
            trigger: { panel: "dev.paperboard.botcreator", action: "on-message" },
            steps: [{ panel: "builtin.logic", action: "log-console", values: { message: "got {{content}}" } }],
        });
        const two = await projectAdd({
            trigger: { panel: "builtin.logic", action: "on-play" },
            steps: [
                { panel: "builtin.logic", action: "math-calculate", values: { expression: "2 + 3" }, ref: "sum" },
                { panel: "builtin.logic", action: "log-console", values: { message: "sum is {{sum}}" } },
            ],
        });
        expect(one.position).not.toEqual(two.position);
        // the built-in blocks a program names in a flow, with their inputs
        const blocks = await actionsApi.call<any[]>(ACTIONS, "list-blocks");
        const block = (action: string) => blocks.find((b) => b.panel === "builtin.logic" && b.action === action);
        expect(block("on-play")).toMatchObject({ event: true });
        expect(block("if")).toMatchObject({ holds: "steps", inputs: { left: { type: "string", required: true }, operator: { options: expect.arrayContaining(["==", "includes"]) } } });
        expect(block("if-else")?.holds).toBe("steps and else");
        expect(block("math-calculate")?.inputs.expression).toBeDefined();
        expect((await actionsApi.list(ACTIONS)).find((a) => a.action === "list-blocks")?.schema?.hidden).toBe(true);
        const run = await actionsApi.call<any>(ACTIONS, `${other.id}/run-flow`, { flowId: two.flowId });
        expect(run.status).toBe("passed");
        const view = await actionsApi.call<any>(ACTIONS, `${other.id}/get-flow`, { flowId: two.flowId });
        expect(view.steps[1].values.message).toBe(`sum is {{${view.steps[0].id}:${view.steps[0].result}}}`);
        await expect(projectAdd({ trigger: { panel: "builtin.logic", action: "on-play" }, steps: [{ panel: "dev.nowhere", action: "x" }] }))
            .rejects.toThrow('dev.nowhere has no action "x"');

        // both projects answer the same event
        await emit("on-message", ["first", "second", one.flowId]);
        // switched off, a project's flows stop starting on events
        await actionsApi.call(ACTIONS, "update-project", { project: other.id, enabled: false });
        await emit("on-message", ["first", "second"]);

        // deleted, the project and every action in it are gone
        await actionsApi.call(ACTIONS, "delete-project", { project: other.id });
        expect((await actionsApi.listProjects(ACTIONS)).map((p) => p.id)).toEqual([mine]);
        await expect(actionsApi.call(ACTIONS, `${other.id}/list-flows`)).rejects.toThrow("not registered");
        expect((await config.get<any>(ACTIONS, "projects.json")).projects.map((p: any) => p.id)).toEqual([mine]);

        // a new project is a draft: nothing of it is written until it has a flow
        const kept = async () => (await config.get<any>(ACTIONS, "projects.json")).projects.map((p: any) => [p.id, p.name]);
        const canvasOf = async (id: string) => (await config.get<any>(ACTIONS, `projects/${id}.json`)) ?? null;
        const scratch = await actionsApi.call<any>(ACTIONS, "create-project", { name: "Scratch" });
        expect(scratch.draft).toBe(true);
        await actionsApi.call(ACTIONS, "update-project", { project: scratch.id, name: "Scratch pad" });
        await save(scratch.id, { flows: [], notes: [{ id: "idea", pos: { x: 0, y: 0 }, text: "an idea" }], functions: [] });
        expect(await kept()).toEqual([[mine, "My flows"]]);
        expect(await canvasOf(scratch.id)).toBeNull();
        // its first flow keeps it, with its name and what was on its canvas
        await save(scratch.id, { flows: [{ ...flows[0], id: "scratch" }], notes: [{ id: "idea", pos: { x: 0, y: 0 }, text: "an idea" }], functions: [] });
        expect(await kept()).toEqual([[mine, "My flows"], [scratch.id, "Scratch pad"]]);
        expect((await canvasOf(scratch.id)).flows.map((f: any) => f.id)).toEqual(["scratch"]);
        expect((await actionsApi.call<any[]>(ACTIONS, "list-projects")).find((p) => p.id === scratch.id).draft).toBe(false);
        // leaving a project discards it only while it is a draft
        await actionsApi.call(ACTIONS, "delete-project", { project: scratch.id, onlyDraft: true });
        expect((await actionsApi.listProjects(ACTIONS)).map((p) => p.id)).toEqual([mine, scratch.id]);
        const empty = await actionsApi.call<any>(ACTIONS, "create-project", {});
        await actionsApi.call(ACTIONS, "delete-project", { project: empty.id, onlyDraft: true });
        expect((await actionsApi.listProjects(ACTIONS)).map((p) => p.id)).toEqual([mine, scratch.id]);
        expect(await kept()).toEqual([[mine, "My flows"], [scratch.id, "Scratch pad"]]);
        expect(await canvasOf(empty.id)).toBeNull();
    } finally {
        bot?.terminate();
        for (const off of offs) off();
        closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30_000);
