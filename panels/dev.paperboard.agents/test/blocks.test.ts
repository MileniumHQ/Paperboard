import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TURN_PROC_ID } from "../src/service/conversation";
import { appRig, type AppRig } from "./support/app";
import { plan, SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const replies = (r: AppRig) => r.blocks.fired.items.filter((f) => f.event === "message-received");

// The agent's blocks (Actions API v2), as the Blocks panel runs them.
describe("the agent's blocks", () => {
    test("registers the agent's types, values, commands and events, and none of the panel's own actions", async () => {
        rig = await appRig();
        const set = rig.blocks.set!;
        expect(set.types!.map((t) => t.id)).toEqual(["conversation", "message", "fact", "note", "routine", "model", "brain", "tool-server", "app", "attachment"]);
        expect(Object.keys(set.types![0]!.fields!)).toEqual(["title", "messages"]);
        expect(Object.keys(set.types![1]!.fields!)).toEqual(["text", "from"]);
        expect(set.values!.map((v) => [v.id, v.type, v.changes ?? false])).toEqual([
            ["current-conversation", "conversation", true],
            ["conversations", "list<conversation>", true],
            ["messages", "list<message>", false],
            ["facts", "list<fact>", true],
            ["notes", "list<note>", true],
            ["routines", "list<routine>", true],
            ["current-brain", "brain", true],
            ["brains", "list<brain>", false],
            ["current-model", "model", true],
            ["models", "list<model>", false],
            ["tool-servers", "list<tool-server>", true],
            ["apps", "list<app>", true],
            ["computer-running", "boolean", true],
        ]);
        expect(set.commands!.map((c) => [c.id, c.output])).toEqual([
            ["switch-conversation", "conversation"],
            ["new-conversation", "conversation"],
            ["clear-conversation", undefined],
            ["delete-conversation", undefined],
            ["send-message", "message"],
            ["get-answer", "text"],
            ["add-fact", "fact"],
            ["edit-fact", "fact"],
            ["forget-fact", undefined],
            ["save-note", "note"],
            ["delete-note", undefined],
            ["add-routine-once", "routine"],
            ["add-routine-daily", "routine"],
            ["add-routine-repeating", "routine"],
            ["cancel-routine", undefined],
            ["switch-brain", undefined],
            ["switch-model", undefined],
            ["install-brain", undefined],
            ["use-brain-on-computer", undefined],
            ["sign-out-brain", undefined],
            ["turn-on-tool-server", undefined],
            ["turn-off-tool-server", undefined],
            ["restart-tool-server", undefined],
            ["delete-app", undefined],
            ["start-computer", undefined],
            ["stop-computer", undefined],
        ]);
        expect(set.events!.map((e) => [e.id, e.filters])).toEqual([
            ["message-received", { conversation: "conversation" }],
            ["turn-failed", { conversation: "conversation" }],
            ["routine-fired", { routine: "routine" }],
        ]);
        expect(Object.keys(set.types!.find((t) => t.id === "tool-server")!.fields!)).toEqual(["name", "enabled", "status", "error", "tools"]);
        // no secrets, sign-ins, provider keys, the computer's screen and input, or a tool server made from a command line
        const ids = [...set.commands!, ...set.values!].map((d) => d.id).join(" ");
        expect(ids).not.toMatch(/secret|key|sign-in|code|provider|frame|input|control|add-tool|save-tool|remove-tool/);
    });

    test("a text to the agent is a Message, its reply fires When the Agent Replies, and the conversations announce the change", async () => {
        rig = await appRig();
        const current = await rig.blocks.read<string>("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("New conversation");

        const message = await rig.blocks.run<string>("send-message", { message: "what's up?" });
        await rig.blocks.fired.until((f) => f.length > 0, "the agent's reply");
        const entry = rig.app.conversation.history().find((e) => e.kind === "agent")!;
        expect(replies(rig)[0]!.payload).toEqual({
            text: entry.kind === "agent" ? entry.text : "",
            attachments: [],
            message: entry.id,
            conversation: current,
            "reply-to": null,
        });
        expect(rig.app.conversation.history()[0]).toMatchObject({ id: message, kind: "user", text: "what's up?" });

        await rig.blocks.changes.until((c) => c.includes("conversations"), "the conversations to announce the change");
        expect(rig.blocks.changes.items).not.toContain("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([current]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("what's up?");
        expect(await rig.blocks.property("conversation", "messages", current)).toBe(2);
    }, SLOW);

    test("New Conversation and Switch Conversation give back the Conversation, and an unknown one is refused", async () => {
        rig = await appRig();
        await rig.blocks.run("send-message", { message: "first" });
        await rig.blocks.fired.until((f) => f.length === 1, "the first reply");
        const first = await rig.blocks.read<string>("current-conversation");

        const second = await rig.blocks.run<string>("new-conversation");
        expect(second).not.toBe(first);
        expect(await rig.blocks.read("current-conversation")).toBe(second);
        await rig.blocks.changes.until((c) => c.includes("current-conversation"), "the current conversation to announce the change");
        expect(await rig.blocks.property("conversation", "title", first)).toBe("first");

        expect(await rig.blocks.run("switch-conversation", { conversation: first })).toBe(first);
        expect(rig.app.conversation.id()).toBe(first);
        await expect(rig.blocks.run("switch-conversation", {})).rejects.toThrow('"Conversation" is required');
        await expect(rig.blocks.property("conversation", "title", "nope")).rejects.toThrow('the agent has no conversation "nope"');
    }, SLOW);

    test("Ask the Agent gives back the answer, never touching the conversation", async () => {
        rig = await appRig();
        expect(await rig.blocks.run("get-answer", { question: "capital of France?" })).toBe("ok: capital of France?");
        expect(rig.app.conversation.history()).toEqual([]);
        expect(rig.host.startedAs(TURN_PROC_ID)).toEqual([]);
        await expect(rig.blocks.run("get-answer", { question: "" })).rejects.toThrow('"Question" is required');
    }, SLOW);

    test("Messages lists a conversation's texts with who sent them, in the history too; Delete and Clear Conversation are for good", async () => {
        rig = await appRig();
        const first = await rig.blocks.read<string>("current-conversation");
        const sent = await rig.blocks.run<string>("send-message", { message: "hello" });
        await rig.blocks.fired.until((f) => replies(rig!).length === 1, "the reply");
        const said = await rig.blocks.read<string[]>("messages", { conversation: first });
        expect(said[0]).toBe(sent);
        expect(said).toHaveLength(2);
        expect(await rig.blocks.property("message", "text", sent)).toBe("hello");
        expect(await rig.blocks.property("message", "from", sent)).toBe("user");
        expect(await rig.blocks.property("message", "from", said[1])).toBe("agent");

        // put away in the history, its texts still read
        const second = await rig.blocks.run<string>("new-conversation");
        expect(await rig.blocks.read("messages", { conversation: first })).toEqual(said);
        expect(await rig.blocks.property("message", "text", sent)).toBe("hello");
        await expect(rig.blocks.run("delete-conversation", { conversation: second })).rejects.toThrow("The current conversation can't be deleted");
        await rig.blocks.run("delete-conversation", { conversation: first });
        expect(await rig.blocks.read("conversations")).toEqual([]);
        await expect(rig.blocks.read("messages", { conversation: first })).rejects.toThrow(`the agent has no conversation "${first}"`);
        await expect(rig.blocks.property("message", "text", sent)).rejects.toThrow(`the agent has no message "${sent}"`);

        await rig.blocks.run("send-message", { message: "again" });
        await rig.blocks.fired.until(() => replies(rig!).length === 2, "the second reply");
        expect(await rig.blocks.read("messages", { conversation: second })).toHaveLength(2);
        const changes = rig.blocks.changes.items.length;
        await rig.blocks.run("clear-conversation");
        expect(await rig.blocks.read("messages", { conversation: second })).toEqual([]);
        expect(await rig.blocks.read("conversations")).toEqual([]);
        expect(rig.blocks.changes.items.slice(changes)).toContain("conversations");
    }, SLOW);

    test("When the Agent's Turn Fails fires with the error, in the conversation it failed in", async () => {
        rig = await appRig();
        const current = await rig.blocks.read<string>("current-conversation");
        await rig.blocks.run("send-message", { message: "[[silent]]" });
        await rig.blocks.fired.until((f) => f.some((x) => x.event === "turn-failed"), "the turn to fail");
        expect(rig.blocks.fired.items.find((f) => f.event === "turn-failed")!.payload).toEqual({ error: "the turn ended without a reply", conversation: current });
    }, SLOW);

    test("facts and notes are added, read, changed and forgotten, and their lists announce the change", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("facts")).toEqual([]);
        const fact = await rig.blocks.run<string>("add-fact", { text: "likes tea" });
        expect(await rig.blocks.read("facts")).toEqual([fact]);
        expect(await rig.blocks.property("fact", "text", fact)).toBe("likes tea");
        await rig.blocks.changes.until((c) => c.includes("facts"), "Facts to announce the change");
        expect(await rig.app.memory.instructions()).toContain("likes tea");

        expect(await rig.blocks.run("edit-fact", { fact, text: "likes coffee" })).toBe(fact);
        expect(await rig.blocks.property("fact", "text", fact)).toBe("likes coffee");
        await expect(rig.blocks.run("add-fact", { text: "two\nlines" })).rejects.toThrow("a fact is one line");

        const note = await rig.blocks.run<string>("save-note", { key: "garden", when: "asked about plants", body: "# Tomatoes\nwater daily" });
        expect(note).toBe("garden");
        expect(await rig.blocks.read("notes")).toEqual(["garden"]);
        expect(await rig.blocks.property("note", "when", note)).toBe("asked about plants");
        expect(await rig.blocks.property("note", "body", note)).toBe("# Tomatoes\nwater daily");
        await rig.blocks.changes.until((c) => c.includes("notes"), "Notes to announce the change");
        await expect(rig.blocks.run("save-note", { key: "Not A Key", when: "never", body: "x" })).rejects.toThrow("a note's key is lowercase letters");

        await rig.blocks.run("forget-fact", { fact });
        await rig.blocks.run("delete-note", { note });
        expect(await rig.blocks.read("facts")).toEqual([]);
        expect(await rig.blocks.read("notes")).toEqual([]);
        await expect(rig.blocks.property("fact", "text", fact)).rejects.toThrow(`the agent has no fact "${fact}"`);
        await expect(rig.blocks.run("forget-fact", { fact })).rejects.toThrow(`no fact ${fact}`);
        await rig.blocks.changes.until((c) => c.filter((v) => v === "facts").length >= 2 && c.filter((v) => v === "notes").length >= 2, "both lists to announce the removal");
    }, SLOW);

    test("routines are added on each kind of schedule, read, cancelled and announced, and one that's due fires When a Routine Fires", async () => {
        rig = await appRig();
        const daily = await rig.blocks.run<string>("add-routine-daily", { task: "check the forum", days: "weekdays", time: "09:00" });
        expect(await rig.blocks.property("routine", "schedule", daily)).toBe("weekdays at 09:00");
        expect(await rig.blocks.property("routine", "task", daily)).toBe("check the forum");
        expect(await rig.blocks.property("routine", "last-run", daily)).toBe(null);
        const repeating = await rig.blocks.run<string>("add-routine-repeating", { task: "water the plants", minutes: 120 });
        expect(await rig.blocks.property("routine", "schedule", repeating)).toBe("every 2 hours");
        const at = new Date(Date.now() + 2 * 24 * 60 * 60_000).setSeconds(0, 0);
        const once = await rig.blocks.run<string>("add-routine-once", { task: "say happy birthday", at });
        expect(await rig.blocks.property("routine", "next", once)).toBe(at);
        expect((await rig.blocks.read<string[]>("routines")).sort()).toEqual([daily, repeating, once].sort());
        await rig.blocks.changes.until((c) => c.includes("routines"), "Routines to announce the change");

        await expect(rig.blocks.run("add-routine-once", { task: "too late", at: Date.now() - 60 * 60_000 })).rejects.toThrow("has already passed");
        await expect(rig.blocks.run("add-routine-daily", { task: "x", days: "weekdays", time: "9am" })).rejects.toThrow("time is HH:MM");
        await expect(rig.blocks.run("add-routine-repeating", { task: "x", minutes: 5 })).rejects.toThrow('"Minutes" must be at least 15');

        await rig.blocks.run("cancel-routine", { routine: daily });
        expect(await rig.blocks.read<string[]>("routines")).not.toContain(daily);
        await expect(rig.blocks.property("routine", "task", daily)).rejects.toThrow(`the agent has no routine "${daily}"`);

        // its time comes: the timer's run, on the routines' own clock
        (rig.app.routines as unknown as { next: Map<string, number> }).next.set(repeating, Date.now() - 1000);
        await rig.app.routines.check();
        expect(rig.blocks.fired.items.find((f) => f.event === "routine-fired")!.payload).toEqual({ routine: repeating, task: "water the plants", late: false });
        expect(await rig.blocks.property("routine", "last-run", repeating)).toBeNumber();
    }, SLOW);

    test("Computer Running reads the computer, and starting one that isn't set up fails with why", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("computer-running")).toBe(false);
        await expect(rig.blocks.run("start-computer")).rejects.toThrow("Set up the computer first.");
        await rig.blocks.run("stop-computer");
        expect(await rig.blocks.read("computer-running")).toBe(false);
    }, SLOW);

    test("Models lists the brain's own models after its default; Switch Model saves one it lists and refuses one it doesn't", async () => {
        rig = await appRig();
        plan(rig.root, {
            models: {
                stdout: JSON.stringify({
                    models: [
                        { slug: "gpt-9-mini", display_name: "GPT-9 mini", description: "Quick", visibility: "list", priority: 2 },
                        { slug: "gpt-9", display_name: "GPT-9", visibility: "list", priority: 1 },
                        { slug: "reviewer", visibility: "hide", priority: 0 },
                    ],
                }),
            },
        });
        expect(await rig.blocks.read("current-model")).toBe("default");
        expect(await rig.blocks.read("models")).toEqual(["default", "gpt-9", "gpt-9-mini"]);
        expect(await rig.blocks.property("model", "name", "default")).toBe("Default");
        expect(await rig.blocks.property("model", "description", "gpt-9-mini")).toBe("Quick");
        expect(await rig.blocks.property("model", "description", "gpt-9")).toBe(null);
        expect(await rig.blocks.property("model", "older", "gpt-9")).toBe(false);
        await expect(rig.blocks.property("model", "name", "reviewer")).rejects.toThrow('Codex has no model "reviewer"');

        await rig.blocks.run("switch-model", { model: "gpt-9" });
        expect(rig.ctx.state.settings!.model).toBe("gpt-9");
        expect(await rig.blocks.read("current-model")).toBe("gpt-9");
        await rig.blocks.changes.until((c) => c.includes("current-model"), "Current Model to announce the change");
        expect(rig.blocks.changes.items).not.toContain("current-brain");
        await expect(rig.blocks.run("switch-model", { model: "reviewer" })).rejects.toThrow('"Model" must be one of Default, GPT-9, GPT-9 mini');
        await rig.blocks.run("switch-model", { model: "default" });
        expect(rig.ctx.state.settings!.model).toBe(null);

        // a list the brain can't give is an error, never an empty list
        plan(rig.root, { models: { stderr: "not today", exit: 1 } });
        await expect(rig.blocks.read("models")).rejects.toThrow("Codex couldn't list its models: not today");
    }, SLOW);

    test("brains are read, installed and signed out of; Switch Brain refuses one that isn't signed in", async () => {
        rig = await appRig({ downloads: ["claude-code"] });
        expect(await rig.blocks.read("brains")).toEqual(["codex", "claude-code", "opencode"]);
        expect(await rig.blocks.read("current-brain")).toBe("codex");
        expect(await rig.blocks.property("brain", "name", "claude-code")).toBe("Claude");
        expect(await rig.blocks.property("brain", "status", "codex")).toBe("ready");
        expect(await rig.blocks.property("brain", "signed-in", "codex")).toBe(true);
        expect(await rig.blocks.property("brain", "installed", "claude-code")).toBe(false);
        expect(await rig.blocks.property("brain", "version", "claude-code")).toBe(null);
        await expect(rig.blocks.property("brain", "name", "gemini")).rejects.toThrow('the agent has no brain "gemini"');

        await rig.blocks.run("install-brain", { brain: "claude-code" });
        expect(await rig.blocks.property("brain", "status", "claude-code")).toBe("installed");
        expect(await rig.blocks.property("brain", "version", "claude-code")).toBe("1.0.0");
        await expect(rig.blocks.run("install-brain", { brain: "claude-code" })).rejects.toThrow("Claude is installed already");
        // the test's computer has no brain of its own to use, and an installed one is the package's
        await expect(rig.blocks.run("use-brain-on-computer", { brain: "opencode" })).rejects.toThrow("OpenCode isn't on this computer");
        await expect(rig.blocks.run("use-brain-on-computer", { brain: "claude-code" })).rejects.toThrow("Claude has its own copy installed already");
        // the download fails loudly
        await expect(rig.blocks.run("install-brain", { brain: "opencode" })).rejects.toThrow("the test has no download for opencode");
        expect(await rig.blocks.property("brain", "error", "opencode")).toContain("OpenCode didn't install");

        await expect(rig.blocks.run("switch-brain", { brain: "claude-code" })).rejects.toThrow("Claude isn't ready: sign in to it first");
        await expect(rig.blocks.run("sign-out-brain", { brain: "claude-code" })).rejects.toThrow("Claude isn't signed in");
        await expect(rig.blocks.run("sign-out-brain", { brain: "opencode" })).rejects.toThrow('"Brain" must be one of Codex, Claude');
        await rig.blocks.run("sign-out-brain", { brain: "codex" });
        expect(await rig.blocks.property("brain", "signed-in", "codex")).toBe(false);
        expect(await rig.blocks.property("brain", "status", "codex")).toBe("installed");
        expect(fs.existsSync(path.join(rig.root, "storage", "brains", "codex", "auth.json"))).toBe(false);
        expect(await rig.blocks.read("current-brain")).toBe("codex");
    }, SLOW);

    test("tool servers are listed with their state, turned off and on, restarted and announced", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("tool-servers")).toEqual([]);
        const program = path.join(rig.root, "whoami-server");
        fs.copyFileSync(path.join(import.meta.dir, "support", "mcpServer.mjs"), program);
        fs.chmodSync(program, 0o755);
        await rig.app.toolsSave({ server: { name: "whoami", transport: "stdio", command: program, args: [], env: {}, enabled: true } });
        expect(await rig.blocks.read("tool-servers")).toEqual(["whoami"]);
        await rig.blocks.changes.until((c) => c.includes("tool-servers"), "Tool Servers to announce the change");
        expect(await rig.blocks.property("tool-server", "name", "whoami")).toBe("whoami");
        expect(await rig.blocks.property("tool-server", "enabled", "whoami")).toBe(true);
        expect(await rig.blocks.property("tool-server", "status", "whoami")).toBe("stopped");

        await rig.blocks.run("restart-tool-server", { server: "whoami" });
        expect(await rig.blocks.property("tool-server", "status", "whoami")).toBe("running");
        expect(await rig.blocks.property("tool-server", "tools", "whoami")).toBe(1);

        await rig.blocks.run("turn-off-tool-server", { server: "whoami" });
        expect(await rig.blocks.property("tool-server", "enabled", "whoami")).toBe(false);
        expect(await rig.blocks.property("tool-server", "status", "whoami")).toBe("stopped");
        expect(await rig.blocks.property("tool-server", "tools", "whoami")).toBe(0);
        expect(rig.app.servers.config.servers[0]).toMatchObject({ name: "whoami", command: program, enabled: false });
        await expect(rig.blocks.run("restart-tool-server", { server: "whoami" })).rejects.toThrow("whoami is switched off: turn it on first");
        await rig.blocks.run("turn-on-tool-server", { server: "whoami" });
        expect(await rig.blocks.property("tool-server", "enabled", "whoami")).toBe(true);
        await expect(rig.blocks.run("turn-on-tool-server", { server: "nope" })).rejects.toThrow('"Tool Server" must be one of whoami');
        await expect(rig.blocks.property("tool-server", "status", "nope")).rejects.toThrow('the agent has no tool server "nope"');

        // one that can't start says why
        fs.rmSync(program);
        await expect(rig.blocks.run("restart-tool-server", { server: "whoami" })).rejects.toThrow("whoami didn't start:");
        expect(await rig.blocks.property("tool-server", "status", "whoami")).toBe("failed");
        expect(await rig.blocks.property("tool-server", "error", "whoami")).toBeString();
    }, SLOW);

    test("the agent's apps are listed with their titles, deleted for good, and announced", async () => {
        rig = await appRig();
        expect(await rig.blocks.read("apps")).toEqual([]);
        const made = await rig.app.apps.toolset().call("start_app", { name: "planner", title: "Assignment planner", description: "Due dates, at a glance" });
        expect(made.isError).toBeFalsy();
        expect(await rig.blocks.read("apps")).toEqual(["planner"]);
        await rig.blocks.changes.until((c) => c.includes("apps"), "Apps to announce the change");
        expect(await rig.blocks.property("app", "title", "planner")).toBe("Assignment planner");
        expect(await rig.blocks.property("app", "description", "planner")).toBe("Due dates, at a glance");

        const folder = path.join(rig.root, "storage", "home", "Apps", "planner");
        expect(fs.existsSync(path.join(folder, "package.json"))).toBe(true);
        await rig.blocks.run("delete-app", { app: "planner" });
        expect(await rig.blocks.read("apps")).toEqual([]);
        expect(fs.existsSync(folder)).toBe(false);
        await expect(rig.blocks.property("app", "title", "planner")).rejects.toThrow('the agent has no app "planner"');
        await rig.blocks.changes.until((c) => c.filter((v) => v === "apps").length >= 2, "Apps to announce the removal");
    }, SLOW);
});
