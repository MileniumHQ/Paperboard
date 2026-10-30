import { describe, expect, test } from "bun:test";
import { ACTION_TOOLS, MAX_FOUND, actionsToolset, type ActionEntry, type ActionsHost, type ProjectEntry } from "../src/service/actionsToolset";

const act = (panelId: string, action: string, schema: ActionEntry["schema"] = {}): ActionEntry => ({
    panelId,
    action,
    schema: { name: action, description: `${action} on ${panelId}`, ...schema },
});

function fake(actions: ActionEntry[], enabled = true, projects: ProjectEntry[] = []) {
    const calls: { panel: string; action: string; inputs: unknown; timeoutMs: number }[] = [];
    const host: ActionsHost = {
        list: async () => actions,
        listProjects: async () => projects,
        call: async (panel, action, inputs, o) => {
            calls.push({ panel, action, inputs, timeoutMs: o.timeoutMs });
            return { ok: true, panel, action };
        },
    };
    let on = enabled;
    const set = actionsToolset({ host, enabled: () => on });
    return { set, calls, switchOff: () => (on = false) };
}

const registry = [
    act("dev.paperboard.gameserver", "start-server", { description: "Start a game server", inputs: { server: { type: "string", label: "Server", required: true, description: "which one" } } }),
    act("dev.paperboard.gameserver", "stop-server", { description: "Stop a game server" }),
    act("dev.paperboard.botcreator", "send-message", { description: "Post a Discord message", output: "string" }),
    act("dev.paperboard.agents", "send-message", { description: "the agent's own" }),
    act("dev.paperboard.actions", "ui-hidden", { internal: true }),
    act("dev.paperboard.actions", "on-output", { eventOnly: true }),
    act("dev.paperboard.actions", "old", { deprecated: "use new" }),
    { panelId: "dev.paperboard.actions", action: "state:get" },
    // withheld whole: it runs shell commands on the user's own computer
    act("dev.paperboard.terminal", "run-terminal-command", { description: "Run a shell command" }),
];

describe("finding actions", () => {
    test("searches by name, description and panel, and shows the inputs", async () => {
        const { set } = fake(registry);
        const r = JSON.parse((await set.call("find_actions", { query: "game server" })).text);
        expect(r.actions.map((a: any) => `${a.panel}:${a.action}`)).toEqual(["dev.paperboard.gameserver:start-server", "dev.paperboard.gameserver:stop-server"]);
        expect(r.actions[0].inputs).toEqual({ server: { type: "string", label: "Server", description: "which one", required: true } });
        const byPanel = JSON.parse((await set.call("find_actions", { panel: "dev.paperboard.botcreator" })).text);
        expect(byPanel.actions[0]).toMatchObject({ action: "send-message", output: "string" });
    });

    test("the agent's own actions, internal, event-only, deprecated and schema-less ones are never offered", async () => {
        const { set } = fake(registry);
        const msg = JSON.parse((await set.call("find_actions", { query: "message" })).text);
        expect(msg.actions.map((a: any) => a.panel)).toEqual(["dev.paperboard.botcreator"]);
        // everything the actions panel registers here is one of those kinds
        expect((await set.call("find_actions", { panel: "dev.paperboard.actions" })).text).toBe("No actions match.");
        expect((await set.call("find_actions", { panel: "dev.paperboard.agents" })).text).toBe("No actions match.");
    });

    test("a withheld panel (the terminal: shell commands on the user's computer) is never offered or named", async () => {
        const { set } = fake(registry);
        expect((await set.call("find_actions", { panel: "dev.paperboard.terminal" })).text).toBe("No actions match.");
        expect((await set.call("find_actions", { query: "shell command" })).text).toBe("No actions match.");
        expect(await set.instructions!()).not.toContain("dev.paperboard.terminal");
    });

    test("at most MAX_FOUND answers, and the rest are counted", async () => {
        const many = Array.from({ length: 25 }, (_, i) => act("dev.paperboard.many", `do-${i}`, { description: "does a thing" }));
        const { set } = fake(many);
        const r = JSON.parse((await set.call("find_actions", { query: "thing" })).text);
        expect(r.actions).toHaveLength(MAX_FOUND);
        expect(r.more).toMatch(/15 more/);
    });

    test("a search needs something to look for", async () => {
        const { set } = fake(registry);
        expect(await set.call("find_actions", {})).toMatchObject({ isError: true });
    });
});

describe("running actions", () => {
    test("runs one by panel and action with its inputs, within the daemon's deadline", async () => {
        const { set, calls } = fake(registry);
        const r = await set.call("run_action", { panel: "dev.paperboard.gameserver", action: "start-server", inputs: { server: "mc" }, timeout_seconds: 500 });
        expect(r.isError).toBeUndefined();
        expect(JSON.parse(r.text)).toEqual({ ok: true, panel: "dev.paperboard.gameserver", action: "start-server" });
        expect(calls).toEqual([{ panel: "dev.paperboard.gameserver", action: "start-server", inputs: { server: "mc" }, timeoutMs: 60_000 }]);
        await set.call("run_action", { panel: "dev.paperboard.gameserver", action: "stop-server" });
        expect(calls[1]).toMatchObject({ inputs: {}, timeoutMs: 30_000 });
    });

    test("what the agent can't find it can't run, even when it names it directly", async () => {
        const { set, calls } = fake(registry);
        for (const [panel, action] of [
            ["dev.paperboard.agents", "send-message"], // itself
            ["dev.paperboard.actions", "ui-hidden"], // internal
            ["dev.paperboard.actions", "on-output"], // event-only
            ["dev.paperboard.actions", "old"], // deprecated
            ["dev.paperboard.actions", "state:get"], // plumbing
            ["dev.paperboard.terminal", "run-terminal-command"], // a withheld panel
            ["dev.paperboard.nobody", "x"],
        ]) {
            expect(await set.call("run_action", { panel, action })).toMatchObject({ isError: true, text: expect.stringContaining("isn't an action you can run") });
        }
        expect(calls).toEqual([]);
    });

    test("bad inputs are refused before anything runs", async () => {
        const { set, calls } = fake(registry);
        const base = { panel: "dev.paperboard.gameserver", action: "start-server" };
        expect(await set.call("run_action", { ...base, inputs: [1] })).toMatchObject({ isError: true });
        expect(await set.call("run_action", { ...base, inputs: { big: "x".repeat(70_000) } })).toMatchObject({ isError: true, text: expect.stringContaining("limited") });
        expect(await set.call("run_action", { panel: 1, action: "x" })).toMatchObject({ isError: true });
        expect(calls).toEqual([]);
    });

    test("a failing action is a tool error with its message; a long result is cut", async () => {
        const failing: ActionsHost = {
            list: async () => registry,
            call: async (_p, a) => {
                if (a === "stop-server") throw new Error("Action \"stop-server\" on panel \"dev.paperboard.gameserver\" is not registered or unavailable");
                return "z".repeat(40_000);
            },
        };
        const set = actionsToolset({ host: failing, enabled: () => true });
        expect(await set.call("run_action", { panel: "dev.paperboard.gameserver", action: "stop-server" })).toMatchObject({ isError: true, text: expect.stringContaining("not registered or unavailable") });
        const long = await set.call("run_action", { panel: "dev.paperboard.gameserver", action: "start-server" });
        expect(long.text.length).toBeLessThan(17_000);
        expect(long.text).toContain("characters cut");
    });

    test("an unavailable registry is a tool error, not an empty result", async () => {
        const down: ActionsHost = { list: async () => Promise.reject(new Error("the daemon is gone")), listProjects: async () => [], call: async () => null };
        const set = actionsToolset({ host: down, enabled: () => true });
        expect(await set.call("find_actions", { query: "x" })).toMatchObject({ isError: true, text: "the daemon is gone" });
        expect(await set.instructions!()).toContain("isn't available");
    });
});

describe("panels with projects", () => {
    const SERVERS = "dev.paperboard.gameserver";
    const projects: ProjectEntry[] = [
        { panelId: SERVERS, id: "survival", name: "Survival" },
        { panelId: SERVERS, id: "creative", name: "Creative" },
    ];
    const withProjects = [
        act(SERVERS, "create-server", { description: "Make a new server", category: "Servers" }),
        { ...act(SERVERS, "survival/send", { description: "Say something in chat", category: "Chat" }), project: "survival" },
        { ...act(SERVERS, "survival/kick", { description: "Kick a player", category: "Players" }), project: "survival" },
        { ...act(SERVERS, "creative/send", { description: "Say something in chat", category: "Chat" }), project: "creative" },
        // hidden from the Actions library, made for programs: offered here
        act("dev.paperboard.actions", "p-1/add-flow", { hidden: true, description: `Adds a flow. ${"The format is spelled out here. ".repeat(30)}` }),
    ];

    test("browsing a panel shows its categories and each project with its own", async () => {
        const { set } = fake(withProjects, true, projects);
        const r = JSON.parse((await set.call("browse_panel", { panel: SERVERS })).text);
        expect(r).toEqual({
            panel: SERVERS,
            actions: 1,
            categories: { Servers: 1 },
            projects: [
                { id: "survival", name: "Survival", actions: 2, categories: { Chat: 1, Players: 1 } },
                { id: "creative", name: "Creative", actions: 1, categories: { Chat: 1 } },
            ],
        });
        expect(await set.call("browse_panel", { panel: "dev.paperboard.terminal" })).toMatchObject({ isError: true });
        expect(await set.call("browse_panel", {})).toMatchObject({ isError: true, text: "Say which panel." });
    });

    test("a search can look in one project, and says which project each match is in", async () => {
        const { set, calls } = fake(withProjects, true, projects);
        const r = JSON.parse((await set.call("find_actions", { panel: SERVERS, project: "creative" })).text);
        expect(r.actions.map((a: any) => [a.action, a.project])).toEqual([["creative/send", "creative"]]);
        const chat = JSON.parse((await set.call("find_actions", { query: "chat" })).text);
        expect(chat.actions.map((a: any) => a.action)).toEqual(["creative/send", "survival/send"]);
        // a project's action runs by its full id
        await set.call("run_action", { panel: SERVERS, action: "survival/send", inputs: {} });
        expect(calls.map((c) => c.action)).toEqual(["survival/send"]);
    });

    test("hidden actions are offered, and a lone match shows its whole description", async () => {
        const { set } = fake(withProjects, true, projects);
        const one = JSON.parse((await set.call("find_actions", { query: "add flow" })).text);
        expect(one.actions).toHaveLength(1);
        expect(one.actions[0].description).toBe(withProjects[4].schema!.description);
        const many = JSON.parse((await set.call("find_actions", { query: "a" })).text);
        const flow = many.actions.find((a: any) => a.action === "p-1/add-flow");
        expect(flow.description.length).toBeLessThanOrEqual(300);
    });
});

describe("the toolset", () => {
    test("three tools and one line naming the panels, however many actions there are", async () => {
        const many = Array.from({ length: 500 }, (_, i) => act(`dev.paperboard.p${i % 30}`, `a${i}`));
        const { set } = fake(many);
        expect((await set.tools()).map((t) => t.name)).toEqual(ACTION_TOOLS.map((t) => t.name));
        const line = (await set.instructions!()) as string;
        expect(line.split("\n")).toHaveLength(1);
        expect(line).toContain("and 10 more");
        expect(line.length).toBeLessThan(800);
    });

    test("switched off, nothing is offered and nothing runs", async () => {
        const { set, calls, switchOff } = fake(registry);
        switchOff();
        expect(await set.tools()).toEqual([]);
        expect(await set.instructions!()).toBe("");
        expect(await set.call("run_action", { panel: "dev.paperboard.gameserver", action: "start-server" })).toMatchObject({ isError: true, text: expect.stringContaining("switched Paperboard actions off") });
        expect(calls).toEqual([]);
    });
});
